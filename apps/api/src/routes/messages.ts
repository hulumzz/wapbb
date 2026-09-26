import type { FastifyInstance } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { campaigns, messageJobs, whatsappAccounts } from '../db/schema.js'
import { canRetryCampaignJob, shouldResumeCampaign } from '../utils/campaign-retry.js'
import { config } from '../config.js'
import { deliverySafety } from '../db/schema.js'

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
      await tx.execute(sql`SELECT pg_advisory_xact_lock(713845210)`)
      const [reference] = await tx.select({ campaignId: messageJobs.campaignId }).from(messageJobs).where(eq(messageJobs.id, params.id)).limit(1)
      if (!reference) return null
      await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, reference.campaignId)).for('update')
      const [current] = await tx.select({
        job: messageJobs,
        campaignStatus: campaigns.status,
        senderPhone: campaigns.senderPhone,
      }).from(messageJobs)
        .innerJoin(campaigns, eq(campaigns.id, messageJobs.campaignId))
        .where(eq(messageJobs.id, params.id))
        .for('update')
        .limit(1)

      if (!current || !canRetryCampaignJob(current.job.status, current.job.deliveryStatus)) return null
      if (current.campaignStatus === 'CANCELLED') return null
      const [account] = await tx.select({ phoneNumber: whatsappAccounts.phoneNumber }).from(whatsappAccounts).where(eq(whatsappAccounts.id, 'default')).limit(1)
      if (current.senderPhone && current.senderPhone !== account?.phoneNumber) throw Object.assign(new Error('Nomor pengirim campaign berbeda dari akun WhatsApp saat ini. Buat campaign baru.'), { statusCode: 409 })
      if (config.WA_SAFETY_ENABLED && (!account?.phoneNumber || !current.senderPhone)) throw Object.assign(new Error('Nomor pengirim campaign belum terverifikasi. Buat campaign baru sebelum retry.'), { statusCode: 409 })
      if (shouldResumeCampaign(current.campaignStatus)) {
        const [active] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.status, 'RUNNING'), sql`${campaigns.id} <> ${reference.campaignId}`)).limit(1)
        if (active) throw Object.assign(new Error('Campaign lain sedang berjalan. Jeda atau selesaikan sebelum retry pesan ini.'), { statusCode: 409 })
        if (config.WA_SAFETY_ENABLED) {
          const [safety] = await tx.select({ mode: deliverySafety.mode }).from(deliverySafety).where(eq(deliverySafety.accountId, 'default')).limit(1)
          if (safety?.mode === 'PAUSED_RISK' || safety?.mode === 'MANUAL_HOLD') throw Object.assign(new Error('Pengiriman sedang dijeda karena risiko. Tinjau akun sebelum retry.'), { statusCode: 409 })
        }
      }

      const now = new Date()
      const [job] = await tx.update(messageJobs).set({
        status: 'QUEUED',
        generation: sql`${messageJobs.generation} + 1`,
        providerMessageId: null,
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
