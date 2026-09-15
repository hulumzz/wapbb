import type { FastifyInstance } from 'fastify'
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
}
