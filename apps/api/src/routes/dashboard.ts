import type { FastifyInstance } from 'fastify'
import { count, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { campaigns, contacts, messageJobs } from '../db/schema.js'
import type { MessagingProvider } from '../providers/whatsapp/types.js'

export async function registerDashboardRoutes(app: FastifyInstance, provider: MessagingProvider) {
  app.get('/api/dashboard', async () => {
    const [[contactMetric], [campaignMetric], [queuedMetric], [sentMetric], [failedMetric], whatsapp] = await Promise.all([
      db.select({ value: count() }).from(contacts).where(eq(contacts.isActive, true)),
      db.select({ value: count() }).from(campaigns).where(eq(campaigns.status, 'RUNNING')),
      db.select({ value: count() }).from(messageJobs).where(eq(messageJobs.status, 'QUEUED')),
      db.select({ value: count() }).from(messageJobs).where(eq(messageJobs.status, 'SENT')),
      db.select({ value: count() }).from(messageJobs).where(eq(messageJobs.status, 'FAILED')),
      provider.getStatus(),
    ])

    return {
      contacts: contactMetric.value,
      activeCampaigns: campaignMetric.value,
      queued: queuedMetric.value,
      sent: sentMetric.value,
      failed: failedMetric.value,
      whatsapp,
    }
  })
}
