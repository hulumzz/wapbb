import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'
import { config } from './config.js'
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
  const app = Fastify({ logger: true })
  const whatsapp = new BaileysProvider()

  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(',').map((item) => item.trim()),
    credentials: true,
  })
  await app.register(jwt, { secret: config.AUTH_SECRET })

  app.get('/health', async () => ({ ok: true, service: 'wapbb-api' }))

  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url ?? ''
    if (request.method === 'OPTIONS' || url === '/health' || url.startsWith('/auth/') || url.startsWith('/internal/')) {
      return
    }

    if (url.startsWith('/api/')) {
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
    app.log.error(error)
    return reply.code(500).send({ message: 'Terjadi kesalahan pada server' })
  })

  app.addHook('onReady', async () => {
    whatsapp.restore().catch((error) => app.log.warn({ err: error }, 'WhatsApp session belum dapat direstore'))
  })

  return app
}
