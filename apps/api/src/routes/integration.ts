import type { FastifyInstance, RouteOptions } from 'fastify'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { campaigns, contacts, messageJobs, messageTemplates } from '../db/schema.js'

const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(1).max(100).default(20), search: z.string().max(120).optional(), status: z.string().max(30).optional(), campaignId: z.string().uuid().optional(), eligible: z.enum(['true', 'false']).optional() })

export function registerIntegrationRoutes(app: FastifyInstance, routes: RouteOptions[]) {
  for (const route of [...routes]) {
    if (!route.url.startsWith('/api/') || route.url.startsWith('/api/auth/') || route.method === 'HEAD') continue
    const url = route.url.replace('/api/', '/integration/v1/')
    app.route({ ...route, url })
  }
}

export function integrationListHandler(resource: string) {
  return async (request: { query: unknown }) => {
    const query = pagination.parse(request.query)
    const { page, perPage, search, status, campaignId, eligible } = query
    const table = resource === 'contacts' ? contacts : resource === 'templates' ? messageTemplates : resource === 'campaigns' ? campaigns : messageJobs
    const filter = resource === 'contacts' ? and(search ? or(ilike(contacts.fullName, `%${search}%`), ilike(contacts.phoneNormalized, `%${search}%`)) : undefined, eligible === 'true' ? and(eq(contacts.isActive, true), eq(contacts.whatsappOptIn, true)) : status === 'INACTIVE' ? eq(contacts.isActive, false) : status === 'OPT_OUT' ? eq(contacts.whatsappOptIn, false) : status === 'ACTIVE' ? eq(contacts.isActive, true) : undefined)
      : resource === 'templates' ? and(search ? ilike(messageTemplates.name, `%${search}%`) : undefined, eligible === 'true' ? eq(messageTemplates.isActive, true) : undefined)
      : resource === 'campaigns' ? and(search ? ilike(campaigns.name, `%${search}%`) : undefined, status ? eq(campaigns.status, status) : undefined)
      : and(campaignId ? eq(messageJobs.campaignId, campaignId) : undefined, search ? or(ilike(messageJobs.recipient, `%${search}%`), ilike(messageJobs.renderedMessage, `%${search}%`)) : undefined, status ? or(eq(messageJobs.status, status), eq(messageJobs.deliveryStatus, status)) : undefined)
    const [metric] = await db.select({ total: sql<number>`count(*)::int` }).from(table).where(filter)
    const items = await db.select().from(table).where(filter).orderBy(desc(table.createdAt), desc(table.id)).limit(perPage).offset((page - 1) * perPage)
    if (resource === 'campaigns' && items.length) {
      const metrics = await db.select({ campaignId: messageJobs.campaignId, recipientCount: sql<number>`count(*)::int`, queuedCount: sql<number>`count(*) FILTER (WHERE status = 'QUEUED')::int`, sentCount: sql<number>`count(*) FILTER (WHERE status = 'SENT')::int`, failedCount: sql<number>`count(*) FILTER (WHERE status = 'FAILED')::int`, deliveredCount: sql<number>`count(*) FILTER (WHERE delivery_status IN ('DELIVERED','READ','PLAYED'))::int`, readCount: sql<number>`count(*) FILTER (WHERE delivery_status IN ('READ','PLAYED'))::int` }).from(messageJobs).where(inArray(messageJobs.campaignId, items.map((item) => item.id))).groupBy(messageJobs.campaignId)
      for (const item of items) {
        const counts = metrics.find((metric) => metric.campaignId === item.id) ?? { recipientCount: 0, queuedCount: 0, sentCount: 0, failedCount: 0, deliveredCount: 0, readCount: 0 }
        Object.assign(item, counts)
      }
    }
    return { items, pagination: { page, perPage, total: metric.total, lastPage: Math.max(1, Math.ceil(metric.total / perPage)) } }
  }
}
