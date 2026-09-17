import { randomUUID } from 'node:crypto'
import Fastify, { type RouteOptions } from 'fastify'
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
import { integrationListHandler, registerIntegrationRoutes } from './routes/integration.js'
import { messagingAudit } from './db/schema.js'
import { safeSecretEqual } from './utils/secret.js'
import type { MessagingProvider } from './providers/whatsapp/types.js'

export async function buildApp(options: { provider?: MessagingProvider; restore?: boolean } = {}) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    trustProxy: config.NODE_ENV === 'production',
  })
  const whatsapp = options.provider ?? new BaileysProvider()
  const sharedRoutes: RouteOptions[] = []
  const auditedObjects = new WeakMap<object, string>()
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/')) sharedRoutes.push(route as RouteOptions)
  })

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
    const path = request.routeOptions.url ?? (request.raw.url ?? '').split('?')[0]
    if (request.method === 'OPTIONS' || path === '/health' || path === '/auth/login' || path === '/internal/dispatch') {
      return
    }

    if (path.startsWith('/api/')) {
      try {
        const payload = await request.jwtVerify<{ role?: string }>()
        if (payload.role !== 'admin') return reply.code(401).send({ message: 'Token admin tidak valid' })
      } catch {
        return reply.code(401).send({ message: 'Sesi admin tidak valid atau sudah berakhir' })
      }
    }
    if (path.startsWith('/integration/')) {
      const admin = Boolean(config.SID_ADMIN_API_KEY && safeSecretEqual(request.headers.authorization, `Bearer ${config.SID_ADMIN_API_KEY}`))
      const operator = Boolean(config.SID_OPERATOR_API_KEY && safeSecretEqual(request.headers.authorization, `Bearer ${config.SID_OPERATOR_API_KEY}`))
      if (!admin && !operator) return reply.code(401).send({ message: 'Key integrasi tidak valid' })
      if (!admin && /\/whatsapp\/(connect|disconnect|qr)$/.test(path)) return reply.code(403).send({ message: 'Pengelolaan koneksi hanya untuk admin' })
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
  // Reuse the exact domain handlers; only list representation differs for SID.
  registerIntegrationRoutes(app, sharedRoutes.map((route) => {
    const resource = route.url.match(/^\/api\/(contacts|templates|campaigns|messages)$/)?.[1]
    return resource && route.method === 'GET' ? { ...route, handler: integrationListHandler(resource) } : route
  }))

  app.addHook('onSend', async (request, _reply, payload) => {
    if (typeof payload === 'string' && ['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      try { const value = JSON.parse(payload) as { id?: string }; if (typeof value.id === 'string') auditedObjects.set(request, value.id.slice(0, 80)) } catch { /* Non-JSON responses have no object ID. */ }
    }
    if (request.routeOptions.url?.startsWith('/integration/') && typeof payload === 'string' && !safeSecretEqual(request.headers.authorization, `Bearer ${config.SID_ADMIN_API_KEY}`)) {
      return payload.replace(/"qrDataUrl":(?:"(?:[^"\\]|\\.)*"|null)/g, '"qrDataUrl":null')
    }
    return payload
  })
  app.addHook('onResponse', async (request, reply) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method) || !/^\/(api|integration)\//.test(request.url) || request.url.includes('/preview')) return
    const path = request.url.split('?')[0]
    const params = request.params as { id?: string; key?: string }
    const actor = typeof request.headers['x-sid-actor-id'] === 'string' && path.startsWith('/integration/') ? request.headers['x-sid-actor-id'].slice(0, 80) : (request.user as { username?: string } | undefined)?.username ?? 'admin'
    try { await db.insert(messagingAudit).values({ id: randomUUID(), actor, source: path.startsWith('/integration/') ? 'siddes' : 'react', action: `${request.method} ${request.routeOptions.url}`, objectId: params?.id ?? auditedObjects.get(request) ?? (path.includes('/whatsapp/') ? 'default' : null), result: reply.statusCode }) }
    catch { app.log.error('Audit messaging tidak dapat dipersist') }
  })

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
    app.log.error({ code: databaseCode ?? 'INTERNAL_ERROR' }, 'Request gagal; detail sensitif tidak dicatat')
    return reply.code(500).send({ message: 'Terjadi kesalahan pada server' })
  })

  app.addHook('onReady', async () => {
    if (options.restore !== false && whatsapp instanceof BaileysProvider) whatsapp.restore().catch(() => app.log.warn('WhatsApp session belum dapat direstore'))
  })

  app.addHook('preClose', async () => {
    if (whatsapp instanceof BaileysProvider) await whatsapp.shutdown()
  })

  return app
}
