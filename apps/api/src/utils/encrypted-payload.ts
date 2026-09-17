import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BufferJSON } from '@whiskeysockets/baileys'
import { config } from '../config.js'

const key = createHash('sha256').update(config.WA_SESSION_ENCRYPTION_KEY).digest()
export function encryptPayload(value: unknown, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value, BufferJSON.replacer), 'utf8'), cipher.final()])
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })
}
export function decryptPayload<T>(value: string, aad: string): T {
  const payload = JSON.parse(value)
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  cipher.setAAD(Buffer.from(aad))
  cipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]).toString('utf8'), BufferJSON.reviver)
}
