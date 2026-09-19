import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import type { FastifyInstance } from 'fastify'
import { MessagingProviderError, type SendTextInput } from '../providers/whatsapp/types.js'

let postgres: EmbeddedPostgres, app: FastifyInstance
let database: typeof import('./client.js')
let sends = 0
let accountReplacements = 0
let onSend: ((input: SendTextInput) => Promise<void>) | null = null
const operatorKey = 'integration-operator-test-key-00000000', adminKey = 'integration-admin-test-key-00000000000'
const headers = { authorization: `Bearer ${operatorKey}` }
const provider = {
  connect: async () => {}, disconnect: async () => {}, replaceAccount: async () => { accountReplacements++ },
  getStatus: async () => ({ status: 'CONNECTED' as const, phoneNumber: '628123456789', qrDataUrl: 'data:image/png;base64,test' }),
  sendText: async (input: SendTextInput) => { await onSend?.(input); await input.beforeRelay?.(); sends++; return { providerMessageId: 'fake' } },
  sendImage: async () => ({ providerMessageId: 'fake' }),
}
before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wapbb-postgres-test-'))
  postgres = new EmbeddedPostgres({ databaseDir: directory, port: 54329, user: 'tester', password: 'ephemeral-test-only', persistent: false, postgresFlags: ['-c', 'io_method=sync'], onLog: () => {}, onError: () => {} })
  await postgres.initialise(); await postgres.start()
  process.env.DATABASE_URL = 'postgresql://tester:ephemeral-test-only@localhost:54329/postgres'
  process.env.SID_OPERATOR_API_KEY = operatorKey; process.env.SID_ADMIN_API_KEY = adminKey
  process.env.INTERNAL_DISPATCH_SECRET = 'isolated-dispatch-test-secret'
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_PASSWORD = 'isolated-test-password'; process.env.AUTH_SECRET = 'isolated-test-jwt-secret-00000000'
  process.env.WA_SESSION_ENCRYPTION_KEY = 'isolated-test-encryption-key-00000000'
  database = await import('./client.js')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(database.db, { migrationsFolder: new URL('../../drizzle/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
  app = await (await import('../app.js')).buildApp({ provider, restore: false }); await app.ready()
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  assert.equal((await fetch(`${address}/health`)).status, 200)
})
after(async () => { await app?.close(); await database?.pool.end(); await postgres?.stop().catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EBUSY') throw error }) })
beforeEach(async () => { sends = 0; accountReplacements = 0; onSend = null; await database.pool.query('TRUNCATE contacts, campaigns, message_templates, messaging_leases, messaging_audit CASCADE') })
async function contact() {
  const response = await app.inject({ method: 'POST', url: '/integration/v1/contacts', headers, payload: { fullName: 'Perwakilan Rumah', phone: '081234567890', whatsappOptIn: true } })
  assert.equal(response.statusCode, 201); return response.json().id as string
}
async function draft() {
  const id = await contact(), key = randomUUID()
  const payload = { name: 'Informasi Umum', content: 'Halo {{nama}}, informasi desa.', contactIds: [id], batchSize: 10 }
  const preview = await app.inject({ method: 'POST', url: '/integration/v1/campaigns/preview', headers, payload })
  assert.equal(preview.statusCode, 200)
  const create = await app.inject({ method: 'POST', url: '/integration/v1/campaigns', headers: { ...headers, 'idempotency-key': key }, payload: { ...payload, previewToken: preview.json().previewToken } })
  assert.equal(create.statusCode, 201, create.body)
  return { id: create.json().id as string, contactId: id, key, payload, previewToken: preview.json().previewToken }
}
const dispatch = () => app.inject({ method: 'POST', url: '/internal/dispatch', headers: { authorization: 'Bearer isolated-dispatch-test-secret' } })

test('scopes, JWT separation, QR redaction and pagination', async () => {
  assert.equal((await app.inject('/integration/v1/contacts')).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: '/integration/v1/whatsapp/connect', headers })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/integration/v1/whatsapp/replace-account', headers })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/integration/v1/whatsapp/connect', headers: { authorization: `Bearer ${adminKey}` } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/integration/v1/whatsapp/replace-account', headers: { authorization: `Bearer ${adminKey}` } })).statusCode, 200)
  assert.equal(accountReplacements, 1)
  assert.equal((await app.inject({ url: '/integration/v1/whatsapp/status', headers })).json().qrDataUrl, null)
  assert.equal((await app.inject({ url: '/api/messages', headers })).statusCode, 401)
  const token = app.jwt.sign({ kind: 'campaign-preview' })
  assert.equal((await app.inject({ url: '/api/messages', headers: { authorization: `Bearer ${token}` } })).statusCode, 401)
  await contact()
  const page = await app.inject({ url: '/integration/v1/contacts?perPage=1', headers })
  assert.equal(page.json().pagination.total, 1); assert.equal(page.json().items.length, 1)
})

test('account replacement is blocked while a campaign is running', async () => {
  const d = await draft()
  await database.pool.query("UPDATE campaigns SET status='RUNNING' WHERE id=$1", [d.id])
  const response = await app.inject({ method: 'POST', url: '/integration/v1/whatsapp/replace-account', headers: { authorization: `Bearer ${adminKey}` } })
  assert.equal(response.statusCode, 409)
  assert.match(response.json().message, /campaign yang sedang berjalan/)
  assert.equal(accountReplacements, 0)
})
test('direct content snapshot and idempotent replay after preview expires', async () => {
  const d = await draft()
  const replay = await app.inject({ method: 'POST', url: '/integration/v1/campaigns', headers: { ...headers, 'idempotency-key': d.key }, payload: { ...d.payload, previewToken: 'expired' } })
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().id, d.id)
  const changed = await app.inject({ method: 'POST', url: '/integration/v1/campaigns', headers: { ...headers, 'idempotency-key': d.key }, payload: { ...d.payload, content: 'Berbeda', previewToken: d.previewToken } })
  assert.equal(changed.statusCode, 409)
  const row = await database.pool.query('SELECT content_snapshot, template_id FROM campaigns WHERE id=$1', [d.id])
  assert.equal(row.rows[0].template_id, null); assert.equal(row.rows[0].content_snapshot, d.payload.content)
})
test('changed contact invalidates preview', async () => {
  const d = await draft()
  await database.pool.query("UPDATE contacts SET full_name='Nama berubah', updated_at=NOW() WHERE id=$1", [d.contactId])
  const result = await app.inject({ method: 'POST', url: '/integration/v1/campaigns', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { ...d.payload, previewToken: d.previewToken } })
  assert.equal(result.statusCode, 409)
})
test('concurrent dispatch sends once and opt-out skips before relay', async () => {
  const d = await draft()
  await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/start`, headers })
  onSend = async () => { await new Promise((resolve) => setTimeout(resolve, 80)) }
  await Promise.all([dispatch(), dispatch()]); assert.equal(sends, 1)
  await database.pool.query("UPDATE message_jobs SET status='QUEUED'; UPDATE campaigns SET status='RUNNING'; UPDATE contacts SET whatsapp_opt_in=false")
  const result = await dispatch(); assert.equal(result.json().skipped, 1); assert.equal(sends, 1)
})
test('pause during preparation prevents relay and leaves queue intact', async () => {
  const d = await draft()
  await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/start`, headers })
  onSend = async () => { await database.pool.query("UPDATE campaigns SET status='PAUSED' WHERE id=$1", [d.id]) }
  await dispatch(); assert.equal(sends, 0)
  const row = await database.pool.query('SELECT status, attempts FROM message_jobs')
  assert.equal(row.rows[0].status, 'QUEUED'); assert.equal(row.rows[0].attempts, 0)
})
test('uncertain send never auto-retries; manual retry changes generation and resumes', async () => {
  const d = await draft()
  await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/start`, headers })
  onSend = async () => { throw new MessagingProviderError('Unknown', 'DELIVERY_UNCERTAIN', true, true) }
  await dispatch()
  const row = await database.pool.query('SELECT * FROM message_jobs')
  assert.equal(row.rows[0].status, 'FAILED'); assert.equal(row.rows[0].delivery_status, 'UNKNOWN')
  const retry = await app.inject({ method: 'POST', url: `/integration/v1/messages/${row.rows[0].id}/retry`, headers })
  assert.equal(retry.statusCode, 200); assert.equal(retry.json().generation, 1)
  assert.equal((await database.pool.query('SELECT status FROM campaigns')).rows[0].status, 'RUNNING')
})
test('session lease excludes second owner and can be released', async () => {
  const { acquireLease, releaseLease } = await import('../utils/lease.js')
  assert.equal(await acquireLease('test-session', 'first'), true)
  assert.equal(await acquireLease('test-session', 'second'), false)
  await releaseLease('test-session', 'first')
  assert.equal(await acquireLease('test-session', 'second'), true)
})

test('cancel during preparation does not resurrect cancelled work', async () => {
  const d = await draft()
  await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/start`, headers })
  onSend = async () => { await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/cancel`, headers }) }
  await dispatch(); assert.equal(sends, 0)
  assert.equal((await database.pool.query('SELECT status FROM message_jobs')).rows[0].status, 'CANCELLED')
})

test('encrypted metadata preserves media descriptors but strips thumbnails and binds message ID', async () => {
  const { encryptPayload, decryptPayload } = await import('../utils/encrypted-payload.js')
  const { stripMediaBytes } = await import('../providers/whatsapp/outbound-metadata.js')
  const source = { imageMessage: { caption: 'Informasi', mediaKey: Buffer.from('key'), jpegThumbnail: Buffer.from('image bytes') } }
  const encrypted = encryptPayload(stripMediaBytes(source), 'outbound:first')
  assert.ok(!encrypted.includes('Informasi'))
  const result = decryptPayload<typeof source>(encrypted, 'outbound:first')
  assert.equal(result.imageMessage.caption, 'Informasi'); assert.equal(result.imageMessage.jpegThumbnail, undefined)
  assert.deepEqual(Buffer.from(result.imageMessage.mediaKey), Buffer.from('key'))
  assert.throws(() => decryptPayload(encrypted, 'outbound:second'))
})

test('serial auth persistence survives restore and cannot resurrect after clear', async () => {
  await database.pool.query("INSERT INTO whatsapp_accounts (id) VALUES ('auth-test') ON CONFLICT DO NOTHING")
  const { createSqlAuthState } = await import('../providers/whatsapp/sql-auth-state.js')
  const auth = await createSqlAuthState('auth-test')
  await Promise.all([auth.saveCreds(), auth.state.keys.set({ session: { test: Buffer.from('signal-key') } })])
  const restored = await createSqlAuthState('auth-test')
  assert.deepEqual(restored.state.creds.noiseKey.public, auth.state.creds.noiseKey.public)
  await restored.flush(); await auth.clear(); await auth.saveCreds(); await auth.state.keys.set({ session: { test: Buffer.from('late-key') } })
  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM whatsapp_auth WHERE account_id='auth-test'")).rows[0].count, 0)
})

test('retired session owner cannot write or delete a new owner auth-state', async () => {
  await database.pool.query("INSERT INTO whatsapp_accounts (id) VALUES ('lease-auth') ON CONFLICT DO NOTHING")
  const { acquireLease, releaseLease } = await import('../utils/lease.js')
  const { createSqlAuthState } = await import('../providers/whatsapp/sql-auth-state.js')
  await acquireLease('whatsapp:lease-auth', 'old')
  const old = await createSqlAuthState('lease-auth', 'old'); await old.saveCreds()
  await releaseLease('whatsapp:lease-auth', 'old'); await acquireLease('whatsapp:lease-auth', 'new')
  await assert.rejects(old.saveCreds()); await assert.rejects(old.clear())
  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM whatsapp_auth WHERE account_id='lease-auth'")).rows[0].count, 1)
})

test('account replacement clears the old persisted session before requesting a new QR', async () => {
  const { BaileysProvider } = await import('../providers/whatsapp/baileys.provider.js')
  const { createSqlAuthState } = await import('../providers/whatsapp/sql-auth-state.js')
  const { acquireLease } = await import('../utils/lease.js')
  const owner = randomUUID()
  await database.pool.query("DELETE FROM whatsapp_auth WHERE account_id='default'; INSERT INTO whatsapp_accounts (id,status,phone_number) VALUES ('default','CONNECTED','628123456789') ON CONFLICT (id) DO UPDATE SET status='CONNECTED', phone_number='628123456789'")
  assert.equal(await acquireLease('whatsapp:default', owner), true)
  const auth = await createSqlAuthState('default', owner)
  await auth.saveCreds()

  let reconnects = 0
  const instance = new BaileysProvider()
  Object.assign(instance, {
    owner,
    clearAuth: auth.clear,
    flushAuth: auth.flush,
    socket: { end: () => undefined },
    state: { status: 'CONNECTED', phoneNumber: '628123456789', qrDataUrl: null },
    connect: async () => { reconnects++ },
  })
  await instance.replaceAccount()

  assert.equal((await database.pool.query("SELECT count(*)::int AS count FROM whatsapp_auth WHERE account_id='default'")).rows[0].count, 0)
  const account = (await database.pool.query("SELECT status, phone_number FROM whatsapp_accounts WHERE id='default'")).rows[0]
  assert.deepEqual(account, { status: 'DISCONNECTED', phone_number: null })
  assert.equal((await instance.getStatus()).phoneNumber, null)
  assert.equal(reconnects, 1)
})

test('old attempt receipt cannot mark new retry delivered; receipts never move backwards', async () => {
  const d = await draft()
  await app.inject({ method: 'POST', url: `/integration/v1/campaigns/${d.id}/start`, headers })
  onSend = async () => { throw new MessagingProviderError('Unknown', 'DELIVERY_UNCERTAIN', false, true) }
  await dispatch()
  const old = (await database.pool.query('SELECT * FROM message_jobs')).rows[0]
  await app.inject({ method: 'POST', url: `/integration/v1/messages/${old.id}/retry`, headers })
  const { BaileysProvider } = await import('../providers/whatsapp/baileys.provider.js')
  const instance = new BaileysProvider() as unknown as { handleMessageUpdates: (updates: unknown[]) => Promise<void> }
  await instance.handleMessageUpdates([{ key: { id: old.provider_message_id }, update: { status: 4 } }])
  assert.equal((await database.pool.query('SELECT delivery_status FROM message_jobs')).rows[0].delivery_status, null)
  onSend = null; await dispatch()
  const current = (await database.pool.query('SELECT * FROM message_jobs')).rows[0]
  await instance.handleMessageUpdates([{ key: { id: current.provider_message_id }, update: { status: 4 } }])
  await instance.handleMessageUpdates([{ key: { id: current.provider_message_id }, update: { status: 2 } }])
  assert.equal((await database.pool.query('SELECT delivery_status FROM message_jobs')).rows[0].delivery_status, 'READ')
})

test('setup failure exits CONNECTING; damaged auth requires reauthentication', async () => {
  const { BaileysProvider } = await import('../providers/whatsapp/baileys.provider.js')
  const broken = new BaileysProvider()
  Object.assign(broken, { openSocket: async () => { throw new Error('temporary setup error') } })
  await broken.connect(); assert.equal((await broken.getStatus()).status, 'DISCONNECTED'); await broken.shutdown()
  await database.pool.query("INSERT INTO whatsapp_accounts (id) VALUES ('default') ON CONFLICT DO NOTHING")
  await database.pool.query("INSERT INTO whatsapp_auth (account_id,key,value) VALUES ('default','creds','invalid-ciphertext') ON CONFLICT (account_id,key) DO UPDATE SET value='invalid-ciphertext'")
  const corrupted = new BaileysProvider(); await corrupted.restore()
  assert.equal((await corrupted.getStatus()).status, 'NEEDS_REAUTH'); await corrupted.shutdown()
  await database.pool.query("DELETE FROM whatsapp_auth WHERE account_id='default'")
})

test('preparation timeout prevents any late relay; relay timeout is uncertain and closes socket', async () => {
  const { BaileysProvider } = await import('../providers/whatsapp/baileys.provider.js')
  let relays = 0, closes = 0
  const makeProvider = (lookupDelay: number, relayDelay: number) => {
    const instance = new BaileysProvider()
    Object.assign(instance, { socket: { user: { id: '628123456789@s.whatsapp.net' }, onWhatsApp: async () => { await new Promise((resolve) => setTimeout(resolve, lookupDelay)); return [{ exists: true }] }, relayMessage: async () => { relays++; if (relayDelay < 0) return new Promise<string>(() => {}); await new Promise((resolve) => setTimeout(resolve, relayDelay)); return 'fake' }, end: () => { closes++ } }, state: { status: 'CONNECTED', phoneNumber: null, qrDataUrl: null } })
    return instance
  }
  const preparing = makeProvider(50, 0)
  await assert.rejects(preparing.sendText({ recipient: '628123456789', text: 'Informasi', idempotencyKey: 'preparing', deadline: Date.now() + 15 }), (error: unknown) => error instanceof MessagingProviderError && !error.deliveryUncertain)
  await new Promise((resolve) => setTimeout(resolve, 70)); assert.equal(relays, 0); await preparing.shutdown()
  const relaying = makeProvider(0, -1)
  await assert.rejects(relaying.sendText({ recipient: '628123456789', text: 'Informasi', idempotencyKey: 'relaying', deadline: Date.now() + 2000 }), (error: unknown) => error instanceof MessagingProviderError && error.deliveryUncertain)
  assert.equal(relays, 1); assert.ok(closes >= 2); await relaying.shutdown()
})
