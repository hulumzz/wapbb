import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys'
import { and, eq, inArray } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { whatsappAuth } from '../../db/schema.js'

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

  return row ? decrypt<T>(row.value, accountId, key) : undefined
}

async function writeValue(accountId: string, key: string, value: unknown): Promise<void> {
  const encrypted = encrypt(value, accountId, key)
  await db.insert(whatsappAuth).values({
    accountId,
    key,
    value: encrypted,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [whatsappAuth.accountId, whatsappAuth.key],
    set: { value: encrypted, updatedAt: new Date() },
  })
}

export async function hasStoredAuthState(accountId: string): Promise<boolean> {
  return Boolean(await readValue(accountId, 'creds'))
}

export async function clearStoredAuthState(accountId: string): Promise<void> {
  await db.delete(whatsappAuth).where(eq(whatsappAuth.accountId, accountId))
}

export async function createSqlAuthState(accountId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  clear: () => Promise<void>
}> {
  const creds = (await readValue<AuthenticationState['creds']>(accountId, 'creds')) ?? initAuthCreds()
  let saveChain = Promise.resolve()
  let acceptingSaves = true
  const clear = async () => {
    acceptingSaves = false
    await saveChain.catch(() => undefined)
    await clearStoredAuthState(accountId)
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
      await db.transaction(async (tx) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
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
      })
    },
    clear,
  }

  return {
    state: { creds, keys },
    saveCreds: () => {
      if (!acceptingSaves) return Promise.resolve()
      saveChain = saveChain.catch(() => undefined).then(() => writeValue(accountId, 'creds', creds))
      return saveChain
    },
    clear,
  }
}
