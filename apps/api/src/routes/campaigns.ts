import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { campaignRecipients, campaigns, contacts, messageJobs, messageTemplates } from '../db/schema.js'
import { renderMessageTemplate } from '../utils/template.js'

const createCampaign = z.object({
  name: z.string().trim().min(2).max(120),
  templateId: z.string().uuid(),
  contactIds: z.array(z.string().uuid()).optional(),
  batchSize: z.coerce.number().int().min(1).max(50).default(10),
})

export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', async () => db.select().from(campaigns).orderBy(desc(campaigns.createdAt)))

  app.post('/api/campaigns', async (request, reply) => {
    const input = createCampaign.parse(request.body)
    const [template] = await db.select().from(messageTemplates).where(and(
      eq(messageTemplates.id, input.templateId),
      eq(messageTemplates.isActive, true),
    )).limit(1)

    if (!template) return reply.code(400).send({ message: 'Template tidak ditemukan atau tidak aktif' })

    const recipientFilter = input.contactIds?.length
      ? and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true), inArray(contacts.id, input.contactIds))
      : and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true))

    const recipients = await db.select().from(contacts).where(recipientFilter)
    if (!recipients.length) return reply.code(400).send({ message: 'Tidak ada kontak eligible untuk campaign ini' })

    const campaignId = randomUUID()
    await db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id: campaignId,
        name: input.name,
        templateId: template.id,
        batchSize: input.batchSize,
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

    return reply.code(201).send({ id: campaignId, recipientCount: recipients.length, status: 'DRAFT' })
  })

  app.post('/api/campaigns/:id/start', async (request) => updateStatus(request, 'RUNNING', { startedAt: new Date() }))
  app.post('/api/campaigns/:id/pause', async (request) => updateStatus(request, 'PAUSED'))
  app.post('/api/campaigns/:id/resume', async (request) => updateStatus(request, 'RUNNING'))
  app.post('/api/campaigns/:id/cancel', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.transaction(async (tx) => {
      await tx.update(campaigns).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(campaigns.id, params.id))
      await tx.update(messageJobs).set({ status: 'CANCELLED', updatedAt: new Date() }).where(and(
        eq(messageJobs.campaignId, params.id),
        eq(messageJobs.status, 'QUEUED'),
      ))
    })
    return { ok: true }
  })
}

async function updateStatus(request: { params: unknown }, status: string, extra: Record<string, unknown> = {}) {
  const params = z.object({ id: z.string().uuid() }).parse(request.params)
  const [updated] = await db.update(campaigns).set({ status, ...extra, updatedAt: new Date() }).where(eq(campaigns.id, params.id)).returning()
  return updated
}
