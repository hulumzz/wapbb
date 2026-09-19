import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { campaigns } from '../db/schema.js'
import type { MessagingProvider } from '../providers/whatsapp/types.js'

export async function registerWhatsappRoutes(app: FastifyInstance, provider: MessagingProvider) {
  app.get('/api/whatsapp/status', async () => provider.getStatus())
  app.get('/api/whatsapp/qr', async (request, reply) => {
    const state = await provider.getStatus()
    if (!state.qrDataUrl) return reply.code(404).send({ message: 'QR belum tersedia', status: state.status })
    return { qrDataUrl: state.qrDataUrl, status: state.status }
  })

  app.post('/api/whatsapp/connect', async () => {
    await provider.connect()
    return provider.getStatus()
  })

  app.post('/api/whatsapp/disconnect', async () => {
    await provider.disconnect()
    return provider.getStatus()
  })

  app.post('/api/whatsapp/replace-account', async (request, reply) => {
    const [running] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, 'RUNNING')).limit(1)
    if (running) {
      return reply.code(409).send({ message: 'Hentikan atau jeda campaign yang sedang berjalan sebelum mengganti akun WhatsApp.' })
    }

    await provider.replaceAccount()
    return provider.getStatus()
  })
}
