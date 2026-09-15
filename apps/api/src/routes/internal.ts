import type { FastifyInstance } from 'fastify'
import { asc, eq, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { campaigns, messageJobs } from '../db/schema.js'
import type { MessagingProvider } from '../providers/whatsapp/types.js'

export async function registerInternalRoutes(app: FastifyInstance, provider: MessagingProvider) {
  app.post('/internal/dispatch', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.INTERNAL_DISPATCH_SECRET}`) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    const state = await provider.getStatus()
    if (state.status !== 'CONNECTED') {
      return reply.code(409).send({ message: 'WhatsApp belum terhubung', status: state.status })
    }

    const [campaign] = await db.select().from(campaigns)
      .where(eq(campaigns.status, 'RUNNING'))
      .orderBy(asc(campaigns.createdAt))
      .limit(1)

    if (!campaign) return { processed: 0, message: 'Tidak ada campaign aktif' }

    const claimed = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH candidates AS (
          SELECT id
          FROM message_jobs
          WHERE campaign_id = ${campaign.id}
            AND status = 'QUEUED'
            AND scheduled_at <= NOW()
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${campaign.batchSize}
        )
        UPDATE message_jobs
        SET status = 'PROCESSING', processing_at = NOW(), updated_at = NOW()
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id, recipient, rendered_message, attempts, max_attempts
      `)
      return result.rows as Array<{
        id: string
        recipient: string
        rendered_message: string
        attempts: number
        max_attempts: number
      }>
    })

    let sent = 0
    let failed = 0

    for (const job of claimed) {
      try {
        const result = await provider.sendText({ recipient: job.recipient, text: job.rendered_message })
        await db.update(messageJobs).set({
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
          attempts: job.attempts + 1,
          updatedAt: new Date(),
        }).where(eq(messageJobs.id, job.id))
        sent += 1
      } catch (error) {
        await db.update(messageJobs).set({
          status: 'FAILED',
          attempts: job.attempts + 1,
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
          updatedAt: new Date(),
        }).where(eq(messageJobs.id, job.id))
        failed += 1
      }
    }

    const [remaining] = await db.select({ count: sql<number>`count(*)` }).from(messageJobs).where(sql`${messageJobs.campaignId} = ${campaign.id} AND ${messageJobs.status} = 'QUEUED'`)
    if (Number(remaining.count) === 0) {
      await db.update(campaigns).set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() }).where(eq(campaigns.id, campaign.id))
    }

    return { processed: claimed.length, sent, failed, campaignId: campaign.id }
  })
}
