import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { campaigns, messageJobs } from '../db/schema.js'
import { MessagingProviderError, type MessagingProvider } from '../providers/whatsapp/types.js'
import { safeSecretEqual } from '../utils/secret.js'

export async function registerInternalRoutes(app: FastifyInstance, provider: MessagingProvider) {
  app.post('/internal/dispatch', async (request, reply) => {
    if (!safeSecretEqual(request.headers.authorization, `Bearer ${config.INTERNAL_DISPATCH_SECRET}`)) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    const state = await provider.getStatus()
    if (state.status !== 'CONNECTED') {
      return reply.code(409).send({ message: 'WhatsApp belum terhubung', status: state.status })
    }

    const staleBefore = new Date(Date.now() - config.PROCESSING_TIMEOUT_MINUTES * 60_000)
    const staleJobs = await db.execute(sql`
      UPDATE message_jobs
      SET status = 'FAILED',
          processing_token = NULL,
          error_code = 'DELIVERY_UNKNOWN_AFTER_RESTART',
          error_message = 'Status pengiriman tidak dapat dipastikan setelah worker berhenti. Periksa sebelum retry manual.',
          updated_at = NOW()
      WHERE status = 'PROCESSING' AND processing_at < ${staleBefore}
      RETURNING id
    `)
    await db.execute(sql`
      UPDATE message_jobs
      SET status = 'FAILED',
          error_code = 'MAX_ATTEMPTS_REACHED',
          error_message = 'Batas percobaan pengiriman telah tercapai.',
          updated_at = NOW()
      WHERE status = 'QUEUED' AND attempts >= max_attempts
    `)

    const [campaign] = await db.select().from(campaigns)
      .where(eq(campaigns.status, 'RUNNING'))
      .orderBy(asc(campaigns.createdAt))
      .limit(1)

    if (!campaign) return { processed: 0, message: 'Tidak ada campaign aktif' }

    const processingToken = randomUUID()
    const claimed = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH candidates AS (
          SELECT job.id
          FROM message_jobs job
          INNER JOIN campaigns campaign ON campaign.id = job.campaign_id
          WHERE job.campaign_id = ${campaign.id}
            AND campaign.status = 'RUNNING'
            AND job.status = 'QUEUED'
            AND job.attempts < job.max_attempts
            AND job.scheduled_at <= NOW()
          ORDER BY job.created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${campaign.batchSize}
        )
        UPDATE message_jobs job
        SET status = 'PROCESSING',
            processing_at = NOW(),
            processing_token = ${processingToken},
            attempts = job.attempts + 1,
            error_code = NULL,
            error_message = NULL,
            updated_at = NOW()
        WHERE job.id IN (SELECT id FROM candidates)
        RETURNING job.id, job.recipient, job.rendered_message, job.attempts, job.max_attempts
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
    let retried = 0
    let circuitBroken = false

    for (const [index, job] of claimed.entries()) {
      try {
        const result = await provider.sendText({
          recipient: job.recipient,
          text: job.rendered_message,
          idempotencyKey: job.id,
        })
        await db.update(messageJobs).set({
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
          processingToken: null,
          updatedAt: new Date(),
        }).where(and(
          eq(messageJobs.id, job.id),
          eq(messageJobs.status, 'PROCESSING'),
          eq(messageJobs.processingToken, processingToken),
        ))
        sent += 1
      } catch (error) {
        const providerError = error instanceof MessagingProviderError
          ? error
          : new MessagingProviderError('Pengiriman gagal tanpa detail provider', 'PROVIDER_ERROR', false, true)
        const shouldRetry = providerError.retryable && job.attempts < job.max_attempts
        const retryDelay = config.RETRY_DELAY_SECONDS * (2 ** Math.max(job.attempts - 1, 0))
        await db.update(messageJobs).set({
          status: shouldRetry ? 'QUEUED' : 'FAILED',
          scheduledAt: shouldRetry ? new Date(Date.now() + retryDelay * 1000) : undefined,
          processingAt: null,
          processingToken: null,
          errorCode: providerError.code,
          errorMessage: providerError.message.slice(0, 500),
          updatedAt: new Date(),
        }).where(and(
          eq(messageJobs.id, job.id),
          eq(messageJobs.status, 'PROCESSING'),
          eq(messageJobs.processingToken, processingToken),
        ))
        if (shouldRetry) retried += 1
        else failed += 1

        const currentState = await provider.getStatus()
        if (providerError.code === 'PROVIDER_DISCONNECTED' || currentState.status !== 'CONNECTED') {
          circuitBroken = true
          const untouched = claimed.slice(index + 1).map((item) => item.id)
          if (untouched.length) {
            await db.update(messageJobs).set({
              status: 'QUEUED',
              attempts: sql`GREATEST(${messageJobs.attempts} - 1, 0)`,
              processingAt: null,
              processingToken: null,
              updatedAt: new Date(),
            }).where(and(
              inArray(messageJobs.id, untouched),
              eq(messageJobs.status, 'PROCESSING'),
              eq(messageJobs.processingToken, processingToken),
            ))
          }
          break
        }
      }
    }

    const [remaining] = await db.select({ count: sql<number>`count(*)` }).from(messageJobs).where(sql`
      ${messageJobs.campaignId} = ${campaign.id}
      AND ${messageJobs.status} IN ('QUEUED', 'PROCESSING')
    `)
    if (Number(remaining.count) === 0) {
      await db.update(campaigns).set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(campaigns.id, campaign.id),
        eq(campaigns.status, 'RUNNING'),
      ))
    }

    return {
      processed: sent + failed + retried,
      claimed: claimed.length,
      sent,
      failed,
      retried,
      circuitBroken,
      recoveredAsUnknown: staleJobs.rows.length,
      campaignId: campaign.id,
    }
  })
}
