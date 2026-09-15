import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { desc, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { contacts } from '../db/schema.js'
import { normalizeIndonesianPhone } from '../utils/phone.js'

const contactInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  whatsappOptIn: z.boolean().default(true),
})

export async function registerContactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', async (request) => {
    const query = z.object({ search: z.string().optional() }).parse(request.query)
    const search = query.search?.trim()

    return db.select().from(contacts)
      .where(search ? or(ilike(contacts.fullName, `%${search}%`), ilike(contacts.phone, `%${search}%`)) : undefined)
      .orderBy(desc(contacts.createdAt))
  })

  app.post('/api/contacts', async (request, reply) => {
    const input = contactInput.parse(request.body)
    const phoneNormalized = normalizeIndonesianPhone(input.phone)
    const [created] = await db.insert(contacts).values({
      id: randomUUID(),
      fullName: input.fullName,
      phone: input.phone,
      phoneNormalized,
      whatsappOptIn: input.whatsappOptIn,
    }).returning()

    return reply.code(201).send(created)
  })

  app.patch('/api/contacts/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const input = contactInput.partial().extend({ isActive: z.boolean().optional() }).parse(request.body)
    const update: Record<string, unknown> = { ...input, updatedAt: new Date() }
    if (input.phone) update.phoneNormalized = normalizeIndonesianPhone(input.phone)

    const [updated] = await db.update(contacts).set(update).where(eq(contacts.id, params.id)).returning()
    return updated
  })

  app.delete('/api/contacts/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await db.update(contacts).set({ isActive: false, updatedAt: new Date() }).where(eq(contacts.id, params.id))
    return reply.code(204).send()
  })
}
