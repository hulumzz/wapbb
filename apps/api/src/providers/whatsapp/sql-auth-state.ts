import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, type AuthenticationState } from '@whiskeysockets/baileys'
import { and, eq } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { whatsappAuth } from '../../db/schema.js'

const encryptionKey = createHash('sha256').update(config.WA_SESSION_ENCRYPTION_KEY).digest()

function encrypt(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const plain = JSON.stringify(value, BufferJSON.replacer)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  })
}

function decrypt<T>(payload: string): T {
  const parsed = JSON.parse(payload) as { iv: string; tag: string; data: string }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parsed.iv, 'base64'))
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

  return row ? decrypt<T>(row.value) : undefined
}

async function writeValue(accountId: string, key: string, value: unknown): Promise<void> {
  await db.insert(whatsappAuth).values({
    accountId,
    key,
    value: encrypt(value),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [whatsappAuth.accountId, whatsappAuth.key],
    set: { value: encrypt(value), updatedAt: new Date() },
  })
}

async function deleteValue(accountId: string, key: string): Promise<void> {
  await db.delete(whatsappAuth).where(
    and(eq(whatsappAuth.accountId, accountId), eq(whatsappAuth.key, key)),
  )
}

export async function hasStoredAuthState(accountId: string): Promise<boolean> {
  return Boolean(await readValue(accountId, 'creds'))
}

export async function createSqlAuthState(accountId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  const creds = (await readValue<AuthenticationState['creds']>(accountId, 'creds')) ?? initAuthCreds()

  const keys: AuthenticationState['keys'] = {
    get: async (type, ids) => {
      const result: Record<string, unknown> = {}
      for (const id of ids) {
        const value = await readValue(accountId, `${type}:${id}`)
        if (value !== undefined) result[id] = value
      }
      return result as never
    },
    set: async (data) => {
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries ?? {})) {
          const key = `${type}:${id}`
          if (value === null || value === undefined) await deleteValue(accountId, key)
          else await writeValue(accountId, key, value)
        }
      }
    },
  }

  return {
    state: { creds, keys },
    saveCreds: () => writeValue(accountId, 'creds', creds),
  }
}
