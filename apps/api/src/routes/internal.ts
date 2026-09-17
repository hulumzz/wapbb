import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { campaigns, contacts, messageAttempts, messageJobs } from '../db/schema.js'
import { confirmsSubmission } from '../providers/whatsapp/delivery-status.js'
import { shouldRetryAutomatically } from '../providers/whatsapp/retry-policy.js'
import { MessagingProviderError, type MessagingProvider } from '../providers/whatsapp/types.js'
import { createStableMessageId } from '../utils/idempotency.js'
import { acquireLease, releaseLease } from '../utils/lease.js'
import { safeSecretEqual } from '../utils/secret.js'

export async function registerInternalRoutes(app: FastifyInstance, provider: MessagingProvider) {
  app.post('/internal/dispatch', async (request, reply) => {
    if (!safeSecretEqual(request.headers.authorization, `Bearer ${config.INTERNAL_DISPATCH_SECRET}`)) return reply.code(401).send({ message: 'Unauthorized' })
    const token = randomUUID(), deadline = Date.now() + 25_000
    if (!await acquireLease('dispatch:default', token)) return { processed: 0, message: 'Dispatcher sedang berjalan' }
    try {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.status, 'RUNNING')).orderBy(asc(campaigns.createdAt)).limit(1)
      if (!campaign) return { processed: 0, message: 'Tidak ada campaign aktif' }
      const state = await provider.getStatus()
      if (state.status !== 'CONNECTED' || state.authPersistence === 'degraded') return reply.code(409).send({ message: 'WhatsApp belum siap mengirim', status: state.status, reason: state.reason })
      const stale = await db.execute(sql`UPDATE message_jobs SET status = 'FAILED', processing_token = NULL, processing_at = NULL, delivery_status = 'UNKNOWN', error_code = 'DELIVERY_UNKNOWN_AFTER_RESTART', error_message = 'Periksa pengiriman sebelum retry manual.', updated_at = NOW() WHERE status = 'PROCESSING' AND processing_at < NOW() - ${config.PROCESSING_TIMEOUT_MINUTES} * INTERVAL '1 minute' RETURNING id`)
      await db.execute(sql`UPDATE message_jobs SET status = 'FAILED', error_code = 'MAX_ATTEMPTS_REACHED', error_message = 'Batas percobaan tercapai.', updated_at = NOW() WHERE status = 'QUEUED' AND attempts >= max_attempts`)
      let sent = 0, failed = 0, retried = 0, skipped = 0, claimed = 0
      let circuitBroken = false
      for (let index = 0; index < campaign.batchSize && Date.now() < deadline - 3000; index++) {
        const job = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for('update')
          if (current?.status !== 'RUNNING') return null
          const [candidate] = await tx.select().from(messageJobs).where(and(eq(messageJobs.campaignId, campaign.id), eq(messageJobs.status, 'QUEUED'), sql`${messageJobs.scheduledAt} <= NOW()`, sql`${messageJobs.attempts} < ${messageJobs.maxAttempts}`)).orderBy(asc(messageJobs.createdAt), asc(messageJobs.id)).for('update', { skipLocked: true }).limit(1)
          if (!candidate) return null
          const providerMessageId = createStableMessageId(candidate.generation ? `${candidate.id}:${candidate.generation}` : candidate.id)
          await tx.insert(messageAttempts).values({ providerMessageId, jobId: candidate.id, generation: candidate.generation }).onConflictDoNothing()
          const [updated] = await tx.update(messageJobs).set({ status: 'PROCESSING', attempts: candidate.attempts + 1, processingAt: new Date(), processingToken: token, providerMessageId, errorCode: null, errorMessage: null, updatedAt: new Date() }).where(eq(messageJobs.id, candidate.id)).returning()
          return updated
        })
        if (!job) break
        claimed++
        const owns = and(eq(messageJobs.id, job.id), eq(messageJobs.status, 'PROCESSING'), eq(messageJobs.processingToken, token))
        const beforeRelay = async () => {
          if (Date.now() >= deadline - 1000) throw new MessagingProviderError('Budget dispatch berakhir', 'PREPARATION_INTERRUPTED', true)
          if (!await acquireLease('dispatch:default', token)) throw new MessagingProviderError('Lease dispatcher hilang', 'PROVIDER_DISCONNECTED', true)
          await db.transaction(async (tx) => {
            const [currentCampaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for('share')
            const [currentJob] = await tx.select().from(messageJobs).where(owns).for('share')
            if (!currentJob || currentCampaign?.status !== 'RUNNING') throw new MessagingProviderError('Campaign atau claim berubah', 'STOP_CAMPAIGN', false)
            const [contact] = await tx.select().from(contacts).where(eq(contacts.id, job.contactId)).for('share')
            if (!contact?.isActive || !contact.whatsappOptIn || contact.phoneNormalized !== job.recipient) throw new MessagingProviderError('Kontak nonaktif, opt-out, atau nomor berubah setelah preview', 'SKIP_CONTACT', false)
          })
        }
        const interactiveCta = config.INTERACTIVE_CTA_ENABLED && job.ctaUrl && job.ctaLabel && job.ctaFooter !== null ? { url: job.ctaUrl, label: job.ctaLabel, footer: job.ctaFooter } : undefined
        const input = { recipient: job.recipient, idempotencyKey: job.generation ? `${job.id}:${job.generation}` : job.id, interactiveCta, deadline: deadline - 1000, beforeRelay }
        let sendStarted = false
        try {
          await beforeRelay()
          sendStarted = true
          if (campaign.useBanner) await provider.sendImage({ ...input, imageUrl: campaign.bannerUrl ?? config.DEFAULT_BANNER_URL, caption: job.renderedMessage })
          else await provider.sendText({ ...input, text: job.renderedMessage })
          await db.update(messageJobs).set({ status: 'SENT', sentAt: new Date(), deliveryStatus: sql`COALESCE(${messageJobs.deliveryStatus}, 'PENDING')`, processingAt: null, processingToken: null, updatedAt: new Date() }).where(owns)
          const [final] = await db.select({ status: messageJobs.status }).from(messageJobs).where(eq(messageJobs.id, job.id))
          if (final?.status === 'SENT') sent++; else failed++
        } catch (error) {
          const failure = error instanceof MessagingProviderError ? error : new MessagingProviderError(sendStarted ? 'Hasil pengiriman tidak dapat dipastikan' : 'Pemeriksaan sebelum relay gagal', sendStarted ? 'DELIVERY_UNCERTAIN' : 'PREPARATION_CHECK_FAILED', !sendStarted, sendStarted)
          const [receipt] = await db.select({ deliveryStatus: messageJobs.deliveryStatus }).from(messageJobs).where(eq(messageJobs.id, job.id))
          if (confirmsSubmission(receipt?.deliveryStatus)) { sent++; continue }
          const stopped = failure.code === 'STOP_CAMPAIGN', ignored = failure.code === 'SKIP_CONTACT'
          const retry = stopped || shouldRetryAutomatically(failure, job.attempts, job.maxAttempts)
          await db.transaction(async (tx) => {
            const [currentCampaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for('update')
            const cancelled = !failure.deliveryUncertain && currentCampaign?.status === 'CANCELLED'
            await tx.update(messageJobs).set({ status: cancelled ? 'CANCELLED' : ignored ? 'SKIPPED' : retry ? 'QUEUED' : 'FAILED', attempts: stopped ? job.attempts - 1 : job.attempts, deliveryStatus: failure.deliveryUncertain ? 'UNKNOWN' : retry || ignored ? null : 'ERROR', processingAt: null, processingToken: null, scheduledAt: retry && !stopped ? new Date(Date.now() + config.RETRY_DELAY_SECONDS * 2 ** Math.max(job.attempts - 1, 0) * 1000) : undefined, errorCode: failure.code, errorMessage: failure.message, updatedAt: new Date() }).where(owns)
          })
          if (ignored) skipped++; else if (retry) retried++; else failed++
          if (stopped || (await provider.getStatus()).status !== 'CONNECTED') { circuitBroken = true; break }
        }
      }
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for('update')
        if (current?.status !== 'RUNNING') return
        const [remaining] = await tx.select({ count: sql<number>`count(*)::int` }).from(messageJobs).where(and(eq(messageJobs.campaignId, campaign.id), sql`${messageJobs.status} IN ('QUEUED', 'PROCESSING')`))
        if (!remaining.count) await tx.update(campaigns).set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() }).where(eq(campaigns.id, campaign.id))
      })
      return { processed: sent + failed + retried + skipped, claimed, submitted: sent, sent, failed, retried, skipped, circuitBroken, recoveredAsUnknown: stale.rows.length, campaignId: campaign.id }
    } finally { await releaseLease('dispatch:default', token).catch(() => undefined) }
  })
}
