import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { messageTemplates } from '../db/schema.js'
import { validateMessageTemplate } from '../utils/template.js'

const templateInput = z.object({
  name: z.string().trim().min(2).max(100),
  content: z.string().trim().min(1).max(4000),
})

export async function registerTemplateRoutes(app: FastifyInstance) {
  app.get('/api/templates/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const [template] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, id)).limit(1)
    return template ?? reply.code(404).send({ message: 'Template tidak ditemukan' })
  })
  app.get('/api/templates', async () => db.select().from(messageTemplates).orderBy(desc(messageTemplates.createdAt)))

  app.post('/api/templates', async (request, reply) => {
    const input = templateInput.parse(request.body)
    validateMessageTemplate(input.content)
    const [created] = await db.insert(messageTemplates).values({ id: randomUUID(), ...input }).returning()
    return reply.code(201).send(created)
  })

  app.patch('/api/templates/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const input = templateInput.partial().extend({ isActive: z.boolean().optional() }).parse(request.body)
    if (input.content) validateMessageTemplate(input.content)
    const [updated] = await db.update(messageTemplates).set({ ...input, updatedAt: new Date() }).where(eq(messageTemplates.id, params.id)).returning()
    if (!updated) return reply.code(404).send({ message: 'Template tidak ditemukan' })
    return updated
  })

  app.delete('/api/templates/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const [updated] = await db.update(messageTemplates).set({ isActive: false, updatedAt: new Date() })
      .where(eq(messageTemplates.id, params.id))
      .returning({ id: messageTemplates.id })
    if (!updated) return reply.code(404).send({ message: 'Template tidak ditemukan' })
    return reply.code(204).send()
  })
}
