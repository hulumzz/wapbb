import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { config } from './config.js'
import { db } from './db/client.js'
import { BaileysProvider } from './providers/whatsapp/baileys.provider.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCampaignRoutes } from './routes/campaigns.js'
import { registerContactRoutes } from './routes/contacts.js'
import { registerDashboardRoutes } from './routes/dashboard.js'
import { registerInternalRoutes } from './routes/internal.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerTemplateRoutes } from './routes/templates.js'
import { registerWhatsappRoutes } from './routes/whatsapp.js'

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: config.NODE_ENV === 'production',
  })
  const whatsapp = new BaileysProvider()

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    strictPreflight: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
  await app.register(jwt, { secret: config.AUTH_SECRET })
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
  })

  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await db.execute(sql`SELECT 1`)
      return { ok: true, service: 'wapbb-api', database: 'connected' }
    } catch {
      return reply.code(503).send({ ok: false, service: 'wapbb-api', database: 'unavailable' })
    }
  })

  app.addHook('onRequest', async (request, reply) => {
    const path = (request.raw.url ?? '').split('?')[0]
    if (request.method === 'OPTIONS' || path === '/health' || path === '/auth/login' || path === '/internal/dispatch') {
      return
    }

    if (path.startsWith('/api/')) {
      try {
        await request.jwtVerify()
      } catch {
        return reply.code(401).send({ message: 'Sesi admin tidak valid atau sudah berakhir' })
      }
    }
  })

  await registerAuthRoutes(app)
  await registerContactRoutes(app)
  await registerTemplateRoutes(app)
  await registerCampaignRoutes(app)
  await registerMessageRoutes(app)
  await registerWhatsappRoutes(app, whatsapp)
  await registerDashboardRoutes(app, whatsapp)
  await registerInternalRoutes(app, whatsapp)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ message: 'Data tidak valid', issues: error.issues })
    }
    const databaseCode = (error as { code?: string }).code
    if (databaseCode === '23505') {
      return reply.code(409).send({ message: 'Data yang sama sudah tersedia' })
    }
    if (databaseCode === '23503') {
      return reply.code(409).send({ message: 'Data masih digunakan dan tidak dapat dihapus' })
    }
    const httpError = error as { statusCode?: number; message?: string }
    if (httpError.statusCode && httpError.statusCode < 500) {
      return reply.code(httpError.statusCode).send({ message: httpError.message ?? 'Request tidak valid' })
    }
    app.log.error(error)
    return reply.code(500).send({ message: 'Terjadi kesalahan pada server' })
  })

  app.addHook('onReady', async () => {
    whatsapp.restore().catch((error) => app.log.warn({ err: error }, 'WhatsApp session belum dapat direstore'))
  })

  app.addHook('onClose', async () => {
    await whatsapp.shutdown()
  })

  return app
}
