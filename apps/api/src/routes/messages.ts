import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { campaigns, messageJobs } from '../db/schema.js'
import { canRetryCampaignJob, shouldResumeCampaign } from '../utils/campaign-retry.js'

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
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select({
        job: messageJobs,
        campaignStatus: campaigns.status,
      }).from(messageJobs)
        .innerJoin(campaigns, eq(campaigns.id, messageJobs.campaignId))
        .where(eq(messageJobs.id, params.id))
        .for('update')
        .limit(1)

      if (!current || !canRetryCampaignJob(current.job.status, current.job.deliveryStatus)) return null
      if (current.campaignStatus === 'CANCELLED') return null

      const now = new Date()
      const [job] = await tx.update(messageJobs).set({
        status: 'QUEUED',
        attempts: 0,
        scheduledAt: now,
        processingAt: null,
        processingToken: null,
        sentAt: null,
        deliveryStatus: null,
        serverAckAt: null,
        deliveredAt: null,
        readAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      }).where(eq(messageJobs.id, params.id)).returning()

      if (job && shouldResumeCampaign(current.campaignStatus)) {
        await tx.update(campaigns).set({
          status: 'RUNNING',
          completedAt: null,
          updatedAt: now,
        }).where(and(
          eq(campaigns.id, job.campaignId),
          eq(campaigns.status, 'COMPLETED'),
        ))
      }
      return job ?? null
    })
    if (!updated) return reply.code(409).send({ message: 'Hanya pesan gagal atau berstatus tidak pasti yang dapat diantrekan ulang' })
    return updated
  })
}
