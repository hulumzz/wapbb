import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { campaignRecipients, campaigns, contacts, messageJobs, messageTemplates } from '../db/schema.js'
import { renderMessageTemplate } from '../utils/template.js'

const createCampaign = z.object({
  name: z.string().trim().min(2).max(120),
  templateId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).optional(),
  batchSize: z.coerce.number().int().min(1).max(50).default(config.DEFAULT_BATCH_SIZE),
  useBanner: z.boolean().default(false),
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
  }))

  app.get('/api/campaigns', async () => db.select({
    ...getTableColumns(campaigns),
    recipientCount: sql<number>`(select count(*)::int from ${campaignRecipients} where ${campaignRecipients.campaignId} = ${campaigns.id})`,
    queuedCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.status} = 'QUEUED')`,
    sentCount: sql<number>`(select count(*)::int from ${messageJobs} where ${messageJobs.campaignId} = ${campaigns.id} and ${messageJobs.status} = 'SENT')`,
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

    const recipients = await eligibleRecipients(input)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })
    return {
      recipientCount: recipients.length,
      useBanner: input.useBanner,
      bannerUrl: input.useBanner ? config.DEFAULT_BANNER_URL : null,
      samples: recipients.slice(0, 3).map((contact) => ({
        contactId: contact.id,
        fullName: contact.fullName,
        recipient: contact.phoneNormalized,
        renderedMessage: renderMessageTemplate(template.content, { nama: contact.fullName }),
      })),
    }
  })

  app.post('/api/campaigns', async (request, reply) => {
    const input = createCampaign.parse(request.body)
    const [template] = await db.select().from(messageTemplates).where(and(
      eq(messageTemplates.id, input.templateId),
      eq(messageTemplates.isActive, true),
    )).limit(1)

    if (!template) return reply.code(400).send({ message: 'Template tidak ditemukan atau tidak aktif' })

    const recipients = await eligibleRecipients(input)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })

    const campaignId = randomUUID()
    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id: campaignId,
        name: input.name,
        templateId: template.id,
        batchSize: input.batchSize,
        useBanner: input.useBanner,
      })

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
      })))
    })

    return reply.code(201).send({ id: campaignId, recipientCount: recipients.length, status: 'DRAFT', useBanner: input.useBanner })
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

async function updateStatus(paramsInput: unknown, reply: FastifyReply, status: string, from: string[], extra: Record<string, unknown> = {}) {
  const params = z.object({ id: z.string().uuid() }).parse(paramsInput)
  const [updated] = await db.update(campaigns).set({ status, ...extra, updatedAt: new Date() }).where(and(
    eq(campaigns.id, params.id),
    inArray(campaigns.status, from),
  )).returning()
  if (!updated) return reply.code(409).send({ message: `Campaign tidak dapat diubah ke ${status} dari status saat ini` })
  return updated
}
