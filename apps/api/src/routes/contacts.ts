import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { desc, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { contacts } from '../db/schema.js'
import { prepareContactImportRows } from '../utils/contact-import.js'
import { normalizeIndonesianPhone } from '../utils/phone.js'

const contactInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  whatsappOptIn: z.boolean().default(false),
})

const contactImportInput = z.object({
  rows: z.array(z.object({
    sheetName: z.string().trim().min(1).max(100).optional(),
    rowNumber: z.number().int().min(1),
    fullName: z.string().max(500),
    phone: z.string().max(100),
    whatsappOptIn: z.boolean().default(true),
  })).min(1).max(1000),
})

export async function registerContactRoutes(app: FastifyInstance) {
  app.get('/api/contacts/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    return contact ?? reply.code(404).send({ message: 'Kontak tidak ditemukan' })
  })
  app.get('/api/contacts', async (request) => {
    const query = z.object({ search: z.string().optional() }).parse(request.query)
    const search = query.search?.trim()

    return db.select().from(contacts)
      .where(search ? or(
        ilike(contacts.fullName, `%${search}%`),
        ilike(contacts.phone, `%${search}%`),
        ilike(contacts.phoneNormalized, `%${search}%`),
      ) : undefined)
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

  app.post('/api/contacts/import', async (request, reply) => {
    const input = contactImportInput.parse(request.body)
    const prepared = prepareContactImportRows(input.rows)

    const inserted = prepared.valid.length
      ? await db.insert(contacts).values(prepared.valid.map((row) => ({
        id: randomUUID(),
        fullName: row.fullName,
        phone: row.phone,
        phoneNormalized: row.phoneNormalized,
        whatsappOptIn: row.whatsappOptIn,
      }))).onConflictDoNothing({ target: contacts.phoneNormalized }).returning({ id: contacts.id })
      : []

    const duplicatesInDatabase = prepared.valid.length - inserted.length
    return reply.code(201).send({
      received: input.rows.length,
      imported: inserted.length,
      duplicates: prepared.duplicateWithinFile + duplicatesInDatabase,
      invalid: prepared.invalid,
      skipped: prepared.skipped,
      issues: prepared.issues,
    })
  })

  app.patch('/api/contacts/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const input = contactInput.partial().extend({ isActive: z.boolean().optional() }).parse(request.body)
    const update: Partial<typeof contacts.$inferInsert> = { ...input, updatedAt: new Date() }
    if (input.phone) update.phoneNormalized = normalizeIndonesianPhone(input.phone)

    const [updated] = await db.update(contacts).set(update).where(eq(contacts.id, params.id)).returning()
    if (!updated) return reply.code(404).send({ message: 'Kontak tidak ditemukan' })
    return updated
  })

  app.delete('/api/contacts/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    const [updated] = await db.update(contacts).set({ isActive: false, updatedAt: new Date() }).where(eq(contacts.id, params.id)).returning({ id: contacts.id })
    if (!updated) return reply.code(404).send({ message: 'Kontak tidak ditemukan' })
    return reply.code(204).send()
  })
}
