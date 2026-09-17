import { createHash, randomUUID } from 'node:crypto'
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
  templateId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(4000).optional(),
  previewToken: z.string().optional(),
  contactIds: z.array(z.string().uuid()).min(1).max(1000),
  batchSize: z.coerce.number().int().min(1).max(50).default(config.DEFAULT_BATCH_SIZE),
  useBanner: z.boolean().default(false),
  useInteractiveCta: z.boolean().default(false),
}).refine((input) => input.content || input.templateId, 'Isi pesan atau template wajib diisi')

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
    const content = await resolveContent(input)
    if (request.routeOptions.url?.startsWith('/integration/')) requireTargets(input)

    const ctaUrl = validateInteractiveCta(input, content, reply)
    if (ctaUrl === null) return

    const recipients = await eligibleRecipients(input)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })
    if (input.contactIds && recipients.length !== new Set(input.contactIds).size) return reply.code(409).send({ message: 'Penerima berubah atau tidak memenuhi persetujuan. Tinjau kembali.' })
    const previewToken = app.jwt.sign({ kind: 'campaign-preview', requestHash: requestDigest(input), snapshotHash: snapshotDigest(content, recipients) }, { expiresIn: '15m' })
    return {
      previewToken,
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
        renderedMessage: renderMessageTemplate(content, { nama: contact.fullName }),
        ctaUrl,
      })),
    }
  })

  app.post('/api/campaigns', async (request, reply) => {
    const input = createCampaign.parse(request.body)
    const idempotencyKey = z.string().uuid().optional().parse(request.headers['idempotency-key'])
    const requestHash = requestDigest(input)
    const integrated = Boolean(request.routeOptions.url?.startsWith('/integration/'))
    if (integrated) {
      requireTargets(input)
      if (!idempotencyKey) throw Object.assign(new Error('Idempotency-Key wajib diisi'), { statusCode: 400 })
    }

    if (idempotencyKey) {
      const existing = await findIdempotentCampaign(idempotencyKey)
      if (existing) {
        if (existing.requestHash !== requestHash) return reply.code(409).send({ message: 'Idempotency key sudah digunakan untuk campaign yang berbeda' })
        return reply.send(withoutRequestHash(existing))
      }
    }

    const content = await resolveContent(input)

    const ctaUrl = validateInteractiveCta(input, content, reply)
    if (ctaUrl === null) return

    const campaignId = randomUUID()
    let recipientCount = 0
    const created = await db.transaction(async (tx) => {
      const recipients = await tx.select().from(contacts).where(and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true), input.contactIds ? inArray(contacts.id, [...new Set(input.contactIds)]) : undefined)).orderBy(contacts.id).for('share')
      if (!recipients.length || (input.contactIds && recipients.length !== new Set(input.contactIds).size)) throw Object.assign(new Error('Penerima berubah. Tinjau campaign kembali.'), { statusCode: 409 })
      if (integrated || input.previewToken) {
        let preview: { kind: string; requestHash: string; snapshotHash: string }
        try { preview = app.jwt.verify(input.previewToken ?? '') }
        catch { throw Object.assign(new Error('Pratinjau berakhir. Tinjau campaign kembali.'), { statusCode: 409 }) }
        if (preview.kind !== 'campaign-preview' || preview.requestHash !== requestHash || preview.snapshotHash !== snapshotDigest(content, recipients)) throw Object.assign(new Error('Isi atau penerima berubah. Tinjau campaign kembali.'), { statusCode: 409 })
      }
      recipientCount = recipients.length
      const [inserted] = await tx.insert(campaigns).values({
        id: campaignId,
        name: input.name,
        templateId: input.templateId,
        contentSnapshot: content,
        bannerUrl: input.useBanner ? config.DEFAULT_BANNER_URL : null,
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
        renderedMessage: renderMessageTemplate(content, { nama: contact.fullName }),
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
      recipientCount,
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

  app.get('/api/campaigns/by-request/:key', async (request, reply) => {
    const { key } = z.object({ key: z.string().uuid() }).parse(request.params)
    const campaign = await findIdempotentCampaign(key)
    return campaign ? withoutRequestHash(campaign) : reply.code(404).send({ message: 'Campaign belum ditemukan' })
  })
}

function requestDigest(input: CampaignInput) {
  const { previewToken: _token, ...payload } = input
  return createCampaignRequestHash(payload)
}
function snapshotDigest(content: string, recipients: Array<typeof contacts.$inferSelect>) {
  return createHash('sha256').update(JSON.stringify({ content, media: { bannerUrl: config.DEFAULT_BANNER_URL, ctaEnabled: config.INTERACTIVE_CTA_ENABLED, ctaLabel: config.INTERACTIVE_CTA_LABEL, ctaFooter: config.INTERACTIVE_CTA_FOOTER }, recipients: recipients.map((c) => ({ id: c.id, name: c.fullName, phone: c.phoneNormalized, version: c.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex')
}
function requireTargets(input: CampaignInput) {
  if (!input.content || !input.contactIds?.length) throw Object.assign(new Error('Isi pesan dan penerima eksplisit wajib diisi'), { statusCode: 400 })
}
async function resolveContent(input: CampaignInput) {
  if (input.content && !input.templateId) return input.content
  const [template] = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, input.templateId!), input.content ? undefined : eq(messageTemplates.isActive, true))).limit(1)
  if (!template) throw Object.assign(new Error('Template tidak ditemukan atau tidak aktif'), { statusCode: 400 })
  return input.content ?? template.content
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
