import type { FastifyInstance } from 'fastify'
import { desc } from 'drizzle-orm'
import { db } from '../db/client.js'
import { messageJobs } from '../db/schema.js'

export async function registerMessageRoutes(app: FastifyInstance) {
  app.get('/api/messages', async () => db.select().from(messageJobs).orderBy(desc(messageJobs.createdAt)).limit(200))
}
