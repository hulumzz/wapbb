import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { messageTemplates } from '../db/schema.js'

const templateInput = z.object({
  name: z.string().trim().min(2).max(100),
  content: z.string().trim().min(1).max(4000),
})

export async function registerTemplateRoutes(app: FastifyInstance) {
  app.get('/api/templates', async () => db.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt)))

  app.post('/api/templates', async (request, reply) => {
    const input = templateInput.parse(request.body)
    const [created] = await db.insert(messageTemplates).values({ id: randomUUID(), ...input }).returning()
    return reply.code(201).send(created)
  })

  app.patch('/api/templates/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const input = templateInput.partial().extend({ isActive: z.boolean().optional() }).parse(request.body)
    const [updated] = await db.update(messageTemplates).set({ ...input, updatedAt: new Date() }).where(eq(messageTemplates.id, params.id)).returning()
    return updated
  })
}
