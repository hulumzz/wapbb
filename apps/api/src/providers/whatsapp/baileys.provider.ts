import { randomUUID } from 'node:crypto'
import makeWASocket, { DisconnectReason, generateWAMessage, prepareWAMessageMedia, type AnyMessageContent, type ConnectionState, type WAMessageUpdate, type WASocket, type WAMessageContent } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { messageAttempts, messageJobs, whatsappAccounts } from '../../db/schema.js'
import { acquireLease, releaseLease } from '../../utils/lease.js'
import { decryptPayload, encryptPayload } from '../../utils/encrypted-payload.js'
import { stripMediaBytes } from './outbound-metadata.js'
import { generateSafeLinkPreview } from './safe-link-preview.js'
import { clearStoredAuthState, createSqlAuthState, hasStoredAuthState } from './sql-auth-state.js'
import { createImageMessageContent, fetchRemoteImage, RemoteImageError, type RemoteImage } from './remote-image.js'
import { createInteractiveCtaMessage, createInteractiveCtaRelayNodes } from './interactive-message.js'
import { allowedPreviousDeliveryStatuses, confirmsSubmission, mapBaileysDeliveryStatus, type DeliveryStatus } from './delivery-status.js'
import { MessagingProviderError, type InteractiveCta, type MessagingProvider, type MessagingState, type SendImageInput, type SendTextInput, type SendResult } from './types.js'
import { createStableMessageId } from '../../utils/idempotency.js'

const ACCOUNT_ID = 'default'
const RECONNECT_DELAY_MS = 3_000
const MAX_RECONNECT_DELAY_MS = 60_000

export class BaileysProvider implements MessagingProvider {
  private socket: WASocket | null = null
  private state: MessagingState = {
    status: 'DISCONNECTED',
    phoneNumber: null,
    qrDataUrl: null,
  }
  private connecting: Promise<void> | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private manualDisconnect = false
  private imageCache: { url: string; promise: Promise<RemoteImage> } | null = null
  private readonly owner = randomUUID()
  private leaseTimer: NodeJS.Timeout | null = null
  private flushAuth: (() => Promise<void>) | null = null
  private authCleanup: Promise<void> = Promise.resolve()
  private authPersistence: 'healthy' | 'degraded' = 'healthy'
  private reason: string | null = null
  private changedAt = new Date().toISOString()

  async restore(): Promise<void> {
    try { await this.ensureAccount(); if (await hasStoredAuthState(ACCOUNT_ID)) await this.connect() }
    catch (error) {
      const invalid = (error as { code?: string }).code === 'AUTH_STATE_INVALID'
      this.reason = invalid ? 'AUTH_STATE_INVALID' : 'RESTORE_FAILED'
      this.state.status = invalid ? 'NEEDS_REAUTH' : 'DISCONNECTED'
      if (!invalid) this.scheduleReconnect()
    }
  }

  async connect(): Promise<void> {
    if (this.socket || this.state.status === 'CONNECTED' || this.state.status === 'CONNECTING') return
    if (this.connecting) return this.connecting

    this.manualDisconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.connecting = this.openSocket().catch(async (error) => {
      this.socket?.end(undefined)
      this.socket = null
      const invalid = (error as { code?: string }).code === 'AUTH_STATE_INVALID'
      this.state.status = invalid ? 'NEEDS_REAUTH' : 'DISCONNECTED'
      this.reason = invalid ? 'AUTH_STATE_INVALID' : 'CONNECTION_SETUP_FAILED'
      this.changedAt = new Date().toISOString()
      if (!invalid) this.scheduleReconnect()
    }).finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async openSocket(): Promise<void> {
    await this.authCleanup
    const resetInvalidAuth = this.state.status === 'NEEDS_REAUTH'
    await this.ensureAccount()
    let ownsLease = false
    try { ownsLease = await acquireLease('whatsapp:default', this.owner) } catch { /* Cannot renew means fail closed. */ }
    if (!ownsLease) {
      this.reason = 'SESSION_IN_USE'
      this.scheduleReconnect()
      return
    }
    if (!this.leaseTimer) {
      this.leaseTimer = setInterval(() => {
        if (this.manualDisconnect) return
        void acquireLease('whatsapp:default', this.owner).then((owned) => {
          if (this.manualDisconnect) return
          if (!owned) throw new Error('Lease lost')
        }).catch(() => {
          this.reason = 'SESSION_LEASE_LOST'
          this.socket?.end(undefined)
          this.socket = null
          this.state.status = 'DISCONNECTED'
          this.scheduleReconnect()
        })
      }, 30_000)
      this.leaseTimer.unref()
    }
    this.reason = null
    this.changedAt = new Date().toISOString()
    this.state = { ...this.state, status: 'CONNECTING', qrDataUrl: null }
    await this.persistStatus('CONNECTING')

    if (resetInvalidAuth) await clearStoredAuthState(ACCOUNT_ID)
    const { state, saveCreds, clear, flush } = await createSqlAuthState(ACCOUNT_ID, this.owner)
    this.authPersistence = 'healthy'
    const setKeys = state.keys.set.bind(state.keys)
    state.keys.set = async (keys) => {
      try { await setKeys(keys) }
      catch (error) { this.authPersistence = 'degraded'; this.reason = 'AUTH_PERSISTENCE_FAILED'; this.socket?.end(undefined); throw error }
    }
    this.flushAuth = flush
    const socket = makeWASocket({
      auth: state,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Baileys mendeteksi URL pada pesan teks dan memakai link-preview-js.
      // Jika metadata/thumbnail gagal dibuat, Baileys tetap mengirim teks biasa.
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
        if (!key.id) return undefined
        const [attempt] = await db.select({ payload: messageAttempts.outboundCiphertext })
          .from(messageAttempts)
          .where(eq(messageAttempts.providerMessageId, key.id))
          .limit(1)
        return attempt?.payload ? decryptPayload<WAMessageContent>(attempt.payload, `outbound:${key.id}`) : undefined
      },
    })
    this.socket = socket

    socket.ev.on('creds.update', () => {
      void saveCreds().catch(() => {
        this.authPersistence = 'degraded'
        this.reason = 'AUTH_PERSISTENCE_FAILED'
        socket.end(undefined)
      })
    })
    socket.ev.on('messages.update', (updates) => {
      void this.handleMessageUpdates(updates).catch((error) => {
        console.error('Gagal menyimpan acknowledgement WhatsApp', error instanceof Error ? error.message : 'unknown error')
      })
    })
    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(socket, update, clear).catch(() => {
        if (this.socket === socket) {
          this.socket = null
          this.state = { ...this.state, status: 'DISCONNECTED', qrDataUrl: null }
          this.scheduleReconnect()
        }
      })
    })
  }

  private async handleConnectionUpdate(socket: WASocket, update: Partial<ConnectionState>, clearAuth: () => Promise<void>): Promise<void> {
    if (this.socket !== socket) return

    if (update.qr) {
      const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 })
      if (this.socket !== socket) return
      this.state = { ...this.state, status: 'QR_READY', qrDataUrl }
      await this.persistStatus('QR_READY')
    }

    if (update.connection === 'open') {
      this.reconnectAttempt = 0
      this.reason = null
      this.changedAt = new Date().toISOString()
      const phoneNumber = socket.user?.id?.split(':')[0]?.split('@')[0] ?? null
      this.state = { status: 'CONNECTED', phoneNumber, qrDataUrl: null }
      await db.update(whatsappAccounts).set({
        status: 'CONNECTED',
        phoneNumber,
        connectedAt: new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(whatsappAccounts.id, ACCOUNT_ID))
    }

    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      const needsFreshSession = statusCode === DisconnectReason.loggedOut
        || statusCode === DisconnectReason.badSession
        || statusCode === DisconnectReason.multideviceMismatch
      const replaced = statusCode === DisconnectReason.connectionReplaced
      this.reason = needsFreshSession ? 'SESSION_INVALID' : replaced ? 'CONNECTION_REPLACED' : 'CONNECTION_CLOSED'
      this.changedAt = new Date().toISOString()
      this.authCleanup = (needsFreshSession ? clearAuth() : this.flushAuth?.() ?? Promise.resolve()).catch(() => { this.authPersistence = 'degraded' })
      this.socket = null
      this.state = {
        status: needsFreshSession ? 'NEEDS_REAUTH' : 'DISCONNECTED',
        phoneNumber: this.state.phoneNumber,
        qrDataUrl: null,
      }
      await this.authCleanup
      await this.persistStatus(this.state.status)

      if (!needsFreshSession && !this.manualDisconnect) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manualDisconnect) return
    const delay = Math.min(RECONNECT_DELAY_MS * (2 ** this.reconnectAttempt), MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch(() => undefined)
    }, delay)
  }

  async disconnect(): Promise<void> {
    await this.shutdown()
    await this.persistStatus('DISCONNECTED')
  }

  async shutdown(): Promise<void> {
    this.manualDisconnect = true
    this.reconnectAttempt = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.end(undefined)
    this.socket = null
    this.state = { ...this.state, status: 'DISCONNECTED', qrDataUrl: null }
    if (this.leaseTimer) clearInterval(this.leaseTimer)
    this.leaseTimer = null
    let timeout: NodeJS.Timeout | undefined
    let drained = false
    try {
      await Promise.race([(this.flushAuth?.() ?? Promise.resolve()).then(() => { drained = true }), new Promise<void>((resolve) => { timeout = setTimeout(resolve, 10_000) })])
    } catch { this.authPersistence = 'degraded' }
    finally { if (timeout) clearTimeout(timeout) }
    if (drained) await releaseLease('whatsapp:default', this.owner).catch(() => undefined)
  }

  async getStatus(): Promise<MessagingState> {
    return { ...this.state, reason: this.reason, changedAt: this.changedAt, authPersistence: this.authPersistence }
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    return this.withDeadline(input.deadline, async () => {
      const socket = this.requireConnectedSocket()
      await this.validateRecipient(socket, input.recipient)
      if (input.interactiveCta) return this.sendInteractiveCta(socket, input.recipient, input.idempotencyKey, input.text, input.interactiveCta, undefined, input.beforeRelay)
      return this.sendContent(socket, input.recipient, input.idempotencyKey, { text: input.text }, input.beforeRelay)
    })
  }

  async sendImage(input: SendImageInput): Promise<SendResult> {
    return this.withDeadline(input.deadline, () => this.sendImagePrepared(input))
  }

  private async sendImagePrepared(input: SendImageInput): Promise<SendResult> {
    const socket = this.requireConnectedSocket()
    await this.validateRecipient(socket, input.recipient)

    let image: RemoteImage
    try {
      image = await this.getRemoteImage(input.imageUrl)
    } catch (error) {
      if (error instanceof RemoteImageError) {
        throw new MessagingProviderError(error.message, error.code, error.retryable)
      }
      throw new MessagingProviderError('Banner campaign tidak dapat disiapkan', 'BANNER_FETCH_FAILED', true)
    }

    if (input.interactiveCta) {
      return this.sendInteractiveCta(socket, input.recipient, input.idempotencyKey, input.caption, input.interactiveCta, image, input.beforeRelay)
    }
    return this.sendContent(socket, input.recipient, input.idempotencyKey, createImageMessageContent(image, input.caption), input.beforeRelay)
  }

  private requireConnectedSocket(): WASocket {
    if (!this.socket || this.state.status !== 'CONNECTED' || this.authPersistence !== 'healthy') {
      throw new MessagingProviderError('WhatsApp belum terhubung', 'PROVIDER_DISCONNECTED', true)
    }
    return this.socket
  }

  private async validateRecipient(socket: WASocket, recipient: string): Promise<void> {
    try {
      const registrations = await socket.onWhatsApp(recipient)
      const registration = registrations?.[0]
      if (!registration?.exists) {
        throw new MessagingProviderError('Nomor tidak terdaftar di WhatsApp', 'INVALID_RECIPIENT', false)
      }
    } catch (error) {
      if (error instanceof MessagingProviderError) throw error
      throw new MessagingProviderError('Validasi nomor ke WhatsApp gagal', 'PROVIDER_LOOKUP_FAILED', true)
    }
  }

  private async sendContent(socket: WASocket, recipient: string, idempotencyKey: string, content: AnyMessageContent, beforeRelay?: () => Promise<void>): Promise<SendResult> {
    const jid = `${recipient}@s.whatsapp.net`
    const messageId = createStableMessageId(idempotencyKey)

    try {
      const result = await generateWAMessage(jid, content, {
        userJid: socket.user!.id, messageId, upload: socket.waUploadToServer, mediaUploadTimeoutMs: 10_000,
        getUrlInfo: (text) => generateSafeLinkPreview(text, socket.waUploadToServer),
      })
      if (!result.message) throw new MessagingProviderError('Pesan tidak dapat disiapkan', 'PREPARATION_FAILED', true)
      return this.relayPrepared(socket, jid, messageId, result.message, false, beforeRelay)
    } catch (error) {
      throw this.mapSendError(error)
    }
  }

  private async sendInteractiveCta(
    socket: WASocket,
    recipient: string,
    idempotencyKey: string,
    text: string,
    interactiveCta: InteractiveCta,
    image?: RemoteImage,
    beforeRelay?: () => Promise<void>,
  ): Promise<SendResult> {
    let imageMessage
    if (image) {
      try {
        const prepared = await prepareWAMessageMedia({
          image: image.data,
          mimetype: image.mimetype,
        }, {
          upload: socket.waUploadToServer,
        })
        imageMessage = prepared.imageMessage ?? undefined
        if (!imageMessage) {
          throw new Error('Baileys tidak menghasilkan imageMessage')
        }
      } catch {
        throw new MessagingProviderError('Upload banner untuk pesan interaktif gagal', 'BANNER_UPLOAD_FAILED', true)
      }
    }

    const jid = `${recipient}@s.whatsapp.net`
    const messageId = createStableMessageId(idempotencyKey)
    const content = createInteractiveCtaMessage({
      text,
      url: interactiveCta.url,
      label: interactiveCta.label,
      footer: interactiveCta.footer,
      imageMessage,
    })

    try {
      return await this.relayPrepared(socket, jid, messageId, content, true, beforeRelay)
    } catch (error) {
      throw this.mapSendError(error)
    }
  }

  private mapSendError(error: unknown): MessagingProviderError {
    if (error instanceof MessagingProviderError) return error
    if (!this.relayStarted) return new MessagingProviderError('Persiapan pesan gagal sebelum relay', 'PREPARATION_FAILED', true)
    const statusCode = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
    if (statusCode === 400 || statusCode === 404) {
      return new MessagingProviderError('Nomor WhatsApp ditolak provider', 'INVALID_RECIPIENT', false)
    }
    if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden) {
      return new MessagingProviderError('Session WhatsApp tidak lagi valid', 'PROVIDER_DISCONNECTED', false, true)
    }
    if (statusCode === DisconnectReason.connectionClosed
      || statusCode === DisconnectReason.connectionLost
      || statusCode === DisconnectReason.unavailableService) {
      return new MessagingProviderError('Koneksi WhatsApp terputus saat pengiriman', 'PROVIDER_DISCONNECTED', true, true)
    }
    return new MessagingProviderError('Pengiriman WhatsApp tidak terkonfirmasi', 'DELIVERY_UNCERTAIN', true, true)
  }

  private deadline = 0
  private relayStarted = false
  private async withDeadline(deadline: number | undefined, operation: () => Promise<SendResult>): Promise<SendResult> {
    this.deadline = deadline ?? Date.now() + 20_000
    this.relayStarted = false
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.deadline = 0
          this.socket?.end(undefined)
          this.socket = null
          this.state.status = 'DISCONNECTED'
          this.scheduleReconnect()
          reject(new MessagingProviderError('Batas waktu pengiriman tercapai', 'SEND_TIMEOUT', !this.relayStarted, this.relayStarted))
        }, Math.max(1, this.deadline - Date.now()))
      })])
    } finally { if (timer) clearTimeout(timer) }
  }

  private async relayPrepared(socket: WASocket, jid: string, messageId: string, content: WAMessageContent, cta: boolean, beforeRelay?: () => Promise<void>): Promise<SendResult> {
    const guard = () => {
      if (Date.now() >= this.deadline || this.socket !== socket || this.state.status !== 'CONNECTED') throw new MessagingProviderError('Pengiriman dihentikan sebelum relay', 'PREPARATION_INTERRUPTED', true)
    }
    guard()
    if (!await acquireLease('whatsapp:default', this.owner)) {
      this.reason = 'SESSION_LEASE_LOST'; socket.end(undefined); this.socket = null; this.state.status = 'DISCONNECTED'; this.scheduleReconnect()
      throw new MessagingProviderError('Kepemilikan session hilang', 'PROVIDER_DISCONNECTED', true)
    }
    await beforeRelay?.()
    await db.update(messageAttempts).set({ outboundCiphertext: encryptPayload(stripMediaBytes(content), `outbound:${messageId}`) }).where(eq(messageAttempts.providerMessageId, messageId))
    guard()
    this.relayStarted = true
    const providerMessageId = await socket.relayMessage(jid, content, { messageId, ...(cta ? { additionalNodes: createInteractiveCtaRelayNodes() } : {}) })
    if (!providerMessageId) throw new MessagingProviderError('Provider tidak memberikan ID pesan', 'MISSING_MESSAGE_ID', false, true)
    return { providerMessageId }
  }

  private getRemoteImage(url: string): Promise<RemoteImage> {
    if (this.imageCache?.url === url) return this.imageCache.promise

    const promise = fetchRemoteImage(url).catch((error) => {
      if (this.imageCache?.promise === promise) this.imageCache = null
      throw error
    })
    this.imageCache = { url, promise }
    return promise
  }

  private async handleMessageUpdates(updates: WAMessageUpdate[]): Promise<void> {
    for (const item of updates) {
      const providerMessageId = item.key.id
      const deliveryStatus = mapBaileysDeliveryStatus(item.update.status)
      if (!providerMessageId || !deliveryStatus) continue

      const previousStatuses = allowedPreviousDeliveryStatuses(deliveryStatus)
      const canAdvance = previousStatuses.length
        ? or(isNull(messageJobs.deliveryStatus), inArray(messageJobs.deliveryStatus, previousStatuses))
        : isNull(messageJobs.deliveryStatus)
      const now = new Date()
      await db.update(messageAttempts).set({ deliveryStatus, updatedAt: now }).where(and(eq(messageAttempts.providerMessageId, providerMessageId), previousStatuses.length ? or(isNull(messageAttempts.deliveryStatus), inArray(messageAttempts.deliveryStatus, previousStatuses)) : isNull(messageAttempts.deliveryStatus)))
      const timestamps = this.deliveryTimestamps(deliveryStatus, now)
      const queueUpdate = confirmsSubmission(deliveryStatus)
        ? {
            status: sql`CASE WHEN ${messageJobs.status} IN ('PROCESSING', 'FAILED') THEN 'SENT' ELSE ${messageJobs.status} END`,
            sentAt: sql`COALESCE(${messageJobs.sentAt}, ${now})`,
            processingAt: null,
            processingToken: null,
            errorCode: null,
            errorMessage: null,
          }
        : deliveryStatus === 'ERROR'
          ? {
              status: sql`CASE WHEN ${messageJobs.status} IN ('PROCESSING', 'SENT') THEN 'FAILED' ELSE ${messageJobs.status} END`,
              processingAt: null,
              processingToken: null,
              errorCode: 'PROVIDER_RECEIPT_ERROR',
              errorMessage: 'WhatsApp melaporkan kegagalan pengantaran pesan.',
            }
          : {}

      await db.update(messageJobs).set({
        deliveryStatus,
        ...timestamps,
        ...queueUpdate,
        updatedAt: now,
      }).where(and(
        eq(messageJobs.providerMessageId, providerMessageId),
        canAdvance,
      ))
    }
  }

  private deliveryTimestamps(status: DeliveryStatus, now: Date) {
    if (status === 'SERVER_ACK') return { serverAckAt: now }
    if (status === 'DELIVERED') return {
      serverAckAt: sql`COALESCE(${messageJobs.serverAckAt}, ${now})`,
      deliveredAt: now,
    }
    if (status === 'READ' || status === 'PLAYED') return {
      serverAckAt: sql`COALESCE(${messageJobs.serverAckAt}, ${now})`,
      deliveredAt: sql`COALESCE(${messageJobs.deliveredAt}, ${now})`,
      readAt: now,
    }
    return {}
  }

  private async ensureAccount(): Promise<void> {
    await db.insert(whatsappAccounts).values({ id: ACCOUNT_ID }).onConflictDoNothing()
  }

  private async persistStatus(status: MessagingState['status']): Promise<void> {
    await db.update(whatsappAccounts).set({ status, updatedAt: new Date() }).where(eq(whatsappAccounts.id, ACCOUNT_ID))
  }
}
