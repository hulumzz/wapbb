import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { messagingLeases, whatsappAuth } from '../../db/schema.js'
import { SerialWrites } from '../../utils/serial-writes.js'

const encryptionKey = createHash('sha256').update(config.WA_SESSION_ENCRYPTION_KEY).digest()

function encrypt(value: unknown, accountId: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(Buffer.from(`${accountId}:${key}`))
  const plain = JSON.stringify(value, BufferJSON.replacer)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return JSON.stringify({
    version: 2,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  })
}

function decrypt<T>(payload: string, accountId: string, key: string): T {
  const parsed = JSON.parse(payload) as { version?: number; iv: string; tag: string; data: string }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parsed.iv, 'base64'))
  if (parsed.version === 2) decipher.setAAD(Buffer.from(`${accountId}:${key}`))
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')

  return JSON.parse(plain, BufferJSON.reviver) as T
}

async function readValue<T>(accountId: string, key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: whatsappAuth.value })
    .from(whatsappAuth)
    .where(and(eq(whatsappAuth.accountId, accountId), eq(whatsappAuth.key, key)))
    .limit(1)

  if (!row) return undefined
  try { return decrypt<T>(row.value, accountId, key) }
  catch { throw Object.assign(new Error('Auth-state tidak dapat didekripsi'), { code: 'AUTH_STATE_INVALID' }) }
}

type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function assertOwnership(tx: AuthTransaction, accountId: string, owner?: string) {
  if (!owner) return
  const [lease] = await tx.select().from(messagingLeases).where(and(eq(messagingLeases.name, `whatsapp:${accountId}`), eq(messagingLeases.owner, owner), sql`${messagingLeases.expiresAt} > NOW()`)).for('share')
  if (!lease) throw new Error('Auth persistence stopped: session lease lost')
}
async function writeValue(accountId: string, key: string, value: unknown, owner?: string): Promise<void> {
  const encrypted = encrypt(value, accountId, key)
  await db.transaction(async (tx) => {
    await assertOwnership(tx, accountId, owner)
    await tx.insert(whatsappAuth).values({
      accountId,
      key,
      value: encrypted,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [whatsappAuth.accountId, whatsappAuth.key],
      set: { value: encrypted, updatedAt: new Date() },
    })
  })
}

export async function hasStoredAuthState(accountId: string): Promise<boolean> {
  return Boolean(await readValue(accountId, 'creds'))
}

export async function clearStoredAuthState(accountId: string): Promise<void> {
  await db.delete(whatsappAuth).where(eq(whatsappAuth.accountId, accountId))
}

export async function createSqlAuthState(accountId: string, owner?: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  clear: () => Promise<void>
  flush: () => Promise<void>
}> {
  const creds = (await readValue<AuthenticationState['creds']>(accountId, 'creds')) ?? initAuthCreds()
  const writes = new SerialWrites()
  let acceptingSaves = true
  const clear = async () => {
    acceptingSaves = false
    await writes.stop().catch(() => undefined)
    await db.transaction(async (tx) => { await assertOwnership(tx, accountId, owner); await tx.delete(whatsappAuth).where(eq(whatsappAuth.accountId, accountId)) })
  }

  const keys: AuthenticationState['keys'] = {
    get: async (type, ids) => {
      if (!ids.length) return {} as never
      const requestedKeys = ids.map((id) => `${type}:${id}`)
      const rows = await db.select({ key: whatsappAuth.key, value: whatsappAuth.value })
        .from(whatsappAuth)
        .where(and(
          eq(whatsappAuth.accountId, accountId),
          inArray(whatsappAuth.key, requestedKeys),
        ))
      const result: Record<string, unknown> = {}
      for (const row of rows) {
        const id = row.key.slice(type.length + 1)
        let value = decrypt(row.value, accountId, row.key)
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
        }
        result[id] = value
      }
      return result as never
    },
    set: async (data) => {
      if (!acceptingSaves) return
      // Capture values before queuing: Baileys may mutate the originals.
      const snapshot = JSON.parse(JSON.stringify(data, BufferJSON.replacer), BufferJSON.reviver) as typeof data
      await writes.run(() => db.transaction(async (tx) => {
        await assertOwnership(tx, accountId, owner)
        const deadline = Date.now() + 5000
        for (const [type, entries] of Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))) {
          for (const [id, value] of Object.entries(entries ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
            if (Date.now() >= deadline) throw new Error('Auth persistence transaction budget exceeded')
            const key = `${type}:${id}`
            if (value === null || value === undefined) {
              await tx.delete(whatsappAuth).where(
                and(eq(whatsappAuth.accountId, accountId), eq(whatsappAuth.key, key)),
              )
            } else {
              const encrypted = encrypt(value, accountId, key)
              await tx.insert(whatsappAuth).values({
                accountId,
                key,
                value: encrypted,
                updatedAt: new Date(),
              }).onConflictDoUpdate({
                target: [whatsappAuth.accountId, whatsappAuth.key],
                set: { value: encrypted, updatedAt: new Date() },
              })
            }
          }
        }
      }))
    },
    clear,
  }

  return {
    state: { creds, keys },
    saveCreds: () => {
      if (!acceptingSaves) return Promise.resolve()
      const snapshot = JSON.parse(JSON.stringify(creds, BufferJSON.replacer), BufferJSON.reviver)
      return writes.run(() => writeValue(accountId, 'creds', snapshot, owner))
    },
    clear,
    flush: async () => { acceptingSaves = false; await writes.stop() },
  }
}
