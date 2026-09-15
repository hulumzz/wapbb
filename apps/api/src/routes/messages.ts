import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { messageJobs } from '../db/schema.js'

export async function registerMessageRoutes(app: FastifyInstance) {
  app.get('/api/messages', async () => db.select().from(messageJobs).orderBy(desc(messageJobs.createdAt)).limit(200))

  app.get('/api/messages/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const [message] = await db.select().from(messageJobs).where(eq(messageJobs.id, params.id)).limit(1)
    if (!message) return reply.code(404).send({ message: 'Message job tidak ditemukan' })
    return message
  })

  app.post('/api/messages/:id/retry', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const [updated] = await db.update(messageJobs).set({
      status: 'QUEUED',
      attempts: 0,
      scheduledAt: new Date(),
      processingAt: null,
      processingToken: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(messageJobs.id, params.id),
      eq(messageJobs.status, 'FAILED'),
    )).returning()
    if (!updated) return reply.code(409).send({ message: 'Hanya job FAILED yang dapat diantrekan ulang' })
    return updated
  })
}
