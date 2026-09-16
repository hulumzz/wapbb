import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { campaignRecipients, campaigns, contacts, messageJobs, messageTemplates } from '../db/schema.js'
import { createCampaignRequestHash } from '../utils/campaign-idempotency.js'
import { extractHttpsUrl } from '../utils/message-link.js'
import { renderMessageTemplate } from '../utils/template.js'

const createCampaign = z.object({
  name: z.string().trim().min(2).max(120),
  templateId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).optional(),
  batchSize: z.coerce.number().int().min(1).max(50).default(config.DEFAULT_BATCH_SIZE),
  useBanner: z.boolean().default(false),
  useInteractiveCta: z.boolean().default(false),
})

type CampaignInput = z.infer<typeof createCampaign>

async function eligibleRecipients(input: Pick<CampaignInput, 'contactIds'>) {
  const contactIds = input.contactIds ? [...new Set(input.contactIds)] : undefined
  if (contactIds && contactIds.length === 0) return []
  const recipientFilter = contactIds?.length
    ? and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true), inArray(contacts.id, contactIds))
    : and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true))
  return db.select().from(contacts).where(recipientFilter)
}

export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns/settings', async () => ({
    defaultBannerUrl: config.DEFAULT_BANNER_URL,
    interactiveCtaEnabled: config.INTERACTIVE_CTA_ENABLED,
    interactiveCtaLabel: config.INTERACTIVE_CTA_LABEL,
    interactiveCtaFooter: config.INTERACTIVE_CTA_FOOTER,
  }))

  app.get('/api/campaigns', async () => db.select({
    ...getTableColumns(campaigns),
    recipientCount: sql<number>`(select count(*)::int from ${campaignRecipients} where ${campaignRecipients.campaignId} = ${campaigns.id})`,
    queuedCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.status} = 'QUEUED')`,
    sentCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.status} = 'SENT')`,
    deliveredCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.deliveryStatus} in ('DELIVERED', 'READ', 'PLAYED'))`,
    readCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.deliveryStatus} in ('READ', 'PLAYED'))`,
    failedCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.status} = 'FAILED')`,
  }).from(campaigns).orderBy(desc(campaigns.createdAt)))

  app.get('/api/campaigns/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, params.id)).limit(1)
    if (!campaign) return reply.code(404).send({ message: 'Campaign tidak ditemukan' })

    const [recipientMetric, statusMetrics] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, params.id)),
      db.select({ status: messageJobs.status, count: sql<number>`count(*)` }).from(messageJobs)
        .where(eq(messageJobs.campaignId, params.id))
        .groupBy(messageJobs.status),
    ])
    return {
      ...campaign,
      recipientCount: Number(recipientMetric[0]?.count ?? 0),
      jobs: Object.fromEntries(statusMetrics.map((item) => [item.status, Number(item.count)])),
    }
  })

  app.post('/api/campaigns/preview', async (request, reply) => {
    const input = createCampaign.parse(request.body)
    const [template] = await db.select().from(messageTemplates).where(and(
      eq(messageTemplates.id, input.templateId),
      eq(messageTemplates.isActive, true),
    )).limit(1)
    if (!template) return reply.code(400).send({ message: 'Template tidak ditemukan atau tidak aktif' })

    const ctaUrl = validateInteractiveCta(input, template.content, reply)
    if (ctaUrl === null) return

    const recipients = await eligibleRecipients(input)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })
    return {
      recipientCount: recipients.length,
      useBanner: input.useBanner,
      useInteractiveCta: input.useInteractiveCta,
      ctaLabel: input.useInteractiveCta ? config.INTERACTIVE_CTA_LABEL : null,
      ctaFooter: input.useInteractiveCta ? config.INTERACTIVE_CTA_FOOTER : null,
      bannerUrl: input.useBanner ? config.DEFAULT_BANNER_URL : null,
      samples: recipients.slice(0, 3).map((contact) => ({
        contactId: contact.id,
        fullName: contact.fullName,
        recipient: contact.phoneNormalized,
        renderedMessage: renderMessageTemplate(template.content, { nama: contact.fullName }),
        ctaUrl,
      })),
    }
  })

  app.post('/api/campaigns', async (request, reply) => {
    const input = createCampaign.parse(request.body)
    const idempotencyKey = z.string().uuid().optional().parse(request.headers['idempotency-key'])
    const requestHash = createCampaignRequestHash(input)

    if (idempotencyKey) {
      const existing = await findIdempotentCampaign(idempotencyKey)
      if (existing) {
        if (existing.requestHash !== requestHash) return reply.code(409).send({ message: 'Idempotency key sudah digunakan untuk campaign yang berbeda' })
        return reply.send(withoutRequestHash(existing))
      }
    }

    const [template] = await db.select().from(messageTemplates).where(and(
      eq(messageTemplates.id, input.templateId),
      eq(messageTemplates.isActive, true),
    )).limit(1)

    if (!template) return reply.code(400).send({ message: 'Template tidak ditemukan atau tidak aktif' })

    const ctaUrl = validateInteractiveCta(input, template.content, reply)
    if (ctaUrl === null) return

    const recipients = await eligibleRecipients(input)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })

    const campaignId = randomUUID()
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(campaigns).values({
        id: campaignId,
        name: input.name,
        templateId: template.id,
        batchSize: input.batchSize,
        useBanner: input.useBanner,
        useInteractiveCta: input.useInteractiveCta,
        ctaLabel: input.useInteractiveCta ? config.INTERACTIVE_CTA_LABEL : null,
        ctaFooter: input.useInteractiveCta ? config.INTERACTIVE_CTA_FOOTER : null,
        idempotencyKey,
        requestHash: idempotencyKey ? requestHash : null,
      }).onConflictDoNothing({ target: campaigns.idempotencyKey }).returning({ id: campaigns.id })
      if (!inserted) return false

      await tx.insert(campaignRecipients).values(recipients.map((contact) => ({
        id: randomUUID(),
        campaignId,
        contactId: contact.id,
      })))

      await tx.insert(messageJobs).values(recipients.map((contact) => ({
        id: randomUUID(),
        campaignId,
        contactId: contact.id,
        recipient: contact.phoneNormalized,
        renderedMessage: renderMessageTemplate(template.content, { nama: contact.fullName }),
        ctaUrl: input.useInteractiveCta ? ctaUrl : null,
        ctaLabel: input.useInteractiveCta ? config.INTERACTIVE_CTA_LABEL : null,
        ctaFooter: input.useInteractiveCta ? config.INTERACTIVE_CTA_FOOTER : null,
      })))
      return true
    })

    if (!created && idempotencyKey) {
      const existing = await findIdempotentCampaign(idempotencyKey)
      if (existing?.requestHash === requestHash) return reply.send(withoutRequestHash(existing))
      return reply.code(409).send({ message: 'Idempotency key sudah digunakan untuk campaign yang berbeda' })
    }

    return reply.code(201).send({
      id: campaignId,
      recipientCount: recipients.length,
      status: 'DRAFT',
      useBanner: input.useBanner,
      useInteractiveCta: input.useInteractiveCta,
    })
  })

  app.post('/api/campaigns/:id/start', async (request, reply) => updateStatus(request.params, reply, 'RUNNING', ['DRAFT'], { startedAt: new Date(), completedAt: null }))
  app.post('/api/campaigns/:id/pause', async (request, reply) => updateStatus(request.params, reply, 'PAUSED', ['RUNNING']))
  app.post('/api/campaigns/:id/resume', async (request, reply) => updateStatus(request.params, reply, 'RUNNING', ['PAUSED'], { completedAt: null }))
  app.post('/api/campaigns/:id/cancel', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const cancelled = await db.transaction(async (tx) => {
      const [updated] = await tx.update(campaigns).set({ status: 'CANCELLED', updatedAt: new Date() }).where(and(
        eq(campaigns.id, params.id),
        inArray(campaigns.status, ['DRAFT', 'RUNNING', 'PAUSED']),
      )).returning({ id: campaigns.id })
      if (!updated) return false
      await tx.update(messageJobs).set({ status: 'CANCELLED', updatedAt: new Date() }).where(and(
        eq(messageJobs.campaignId, params.id),
        eq(messageJobs.status, 'QUEUED'),
      ))
      return true
    })
    if (!cancelled) return reply.code(409).send({ message: 'Campaign tidak ditemukan atau sudah final' })
    return { ok: true }
  })
}

async function findIdempotentCampaign(idempotencyKey: string) {
  const [existing] = await db.select({
    id: campaigns.id,
    requestHash: campaigns.requestHash,
    status: campaigns.status,
    useBanner: campaigns.useBanner,
    useInteractiveCta: campaigns.useInteractiveCta,
    recipientCount: sql<number>`(select count(*)::int from ${campaignRecipients} where ${campaignRecipients.campaignId} = ${campaigns.id})`,
  }).from(campaigns).where(eq(campaigns.idempotencyKey, idempotencyKey)).limit(1)
  return existing
}

function withoutRequestHash<T extends { requestHash: unknown }>(campaign: T): Omit<T, 'requestHash'> {
  const { requestHash: _requestHash, ...response } = campaign
  return response
}

function validateInteractiveCta(input: CampaignInput, templateContent: string, reply: FastifyReply): string | undefined | null {
  if (!input.useInteractiveCta) return undefined
  if (!config.INTERACTIVE_CTA_ENABLED) {
    reply.code(409).send({ message: 'Tombol tindakan belum diaktifkan pada konfigurasi server' })
    return null
  }

  const url = extractHttpsUrl(templateContent)
  if (!url) {
    reply.code(400).send({ message: 'Template harus memiliki URL HTTPS untuk menggunakan tombol tindakan' })
    return null
  }
  return url
}

async function updateStatus(paramsInput: unknown, reply: FastifyReply, status: string, from: string[], extra: Record<string, unknown> = {}) {
  const params = z.object({ id: z.string().uuid() }).parse(paramsInput)
  const [updated] = await db.update(campaigns).set({ status, ...extra, updatedAt: new Date() }).where(and(
    eq(campaigns.id, params.id),
    inArray(campaigns.status, from),
  )).returning()
  if (!updated) return reply.code(409).send({ message: `Campaign tidak dapat diubah ke ${status} dari status saat ini` })
  return updated
}
