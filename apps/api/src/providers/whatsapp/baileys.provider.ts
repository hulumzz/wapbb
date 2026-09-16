import makeWASocket, { DisconnectReason, prepareWAMessageMedia, type AnyMessageContent, type ConnectionState, type WASocket } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/client.js'
import { messageJobs, whatsappAccounts } from '../../db/schema.js'
import { createSqlAuthState, hasStoredAuthState } from './sql-auth-state.js'
import { createImageMessageContent, fetchRemoteImage, RemoteImageError, type RemoteImage } from './remote-image.js'
import { createInteractiveCtaMessage, createInteractiveCtaRelayNodes, extractInteractiveCtaUrl } from './interactive-message.js'
import { MessagingProviderError, type MessagingProvider, type MessagingState, type SendImageInput, type SendTextInput, type SendResult } from './types.js'
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

  async restore(): Promise<void> {
    await this.ensureAccount()
    if (await hasStoredAuthState(ACCOUNT_ID)) await this.connect()
  }

  async connect(): Promise<void> {
    if (this.socket || this.state.status === 'CONNECTED' || this.state.status === 'CONNECTING') return
    if (this.connecting) return this.connecting

    this.manualDisconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.connecting = this.openSocket().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async openSocket(): Promise<void> {
    await this.ensureAccount()
    this.state = { ...this.state, status: 'CONNECTING', qrDataUrl: null }
    await this.persistStatus('CONNECTING')

    const { state, saveCreds, clear } = await createSqlAuthState(ACCOUNT_ID)
    const socket = makeWASocket({
      auth: state,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Baileys mendeteksi URL pada pesan teks dan memakai link-preview-js.
      // Jika metadata/thumbnail gagal dibuat, Baileys tetap mengirim teks biasa.
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
        if (!key.id) return undefined
        const [job] = await db.select({ renderedMessage: messageJobs.renderedMessage })
          .from(messageJobs)
          .where(eq(messageJobs.providerMessageId, key.id))
          .limit(1)
        return job ? { conversation: job.renderedMessage } : undefined
      },
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)
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
      this.state = { ...this.state, status: 'QR_READY', qrDataUrl }
      await this.persistStatus('QR_READY')
    }

    if (update.connection === 'open') {
      this.reconnectAttempt = 0
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
      this.socket = null
      this.state = {
        status: needsFreshSession ? 'NEEDS_REAUTH' : 'DISCONNECTED',
        phoneNumber: this.state.phoneNumber,
        qrDataUrl: null,
      }
      if (needsFreshSession) await clearAuth()
      await this.persistStatus(this.state.status)

      if (!needsFreshSession && !replaced && !this.manualDisconnect) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
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
  }

  async getStatus(): Promise<MessagingState> {
    return this.state
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const socket = this.requireConnectedSocket()
    await this.validateRecipient(socket, input.recipient)
    const ctaUrl = config.EXPERIMENTAL_INTERACTIVE_CTA ? extractInteractiveCtaUrl(input.text) : undefined
    if (ctaUrl) {
      return this.sendInteractiveCta(socket, input.recipient, input.idempotencyKey, input.text, ctaUrl)
    }
    return this.sendContent(socket, input.recipient, input.idempotencyKey, { text: input.text })
  }

  async sendImage(input: SendImageInput): Promise<SendResult> {
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

    const ctaUrl = config.EXPERIMENTAL_INTERACTIVE_CTA ? extractInteractiveCtaUrl(input.caption) : undefined
    if (ctaUrl) {
      return this.sendInteractiveCta(socket, input.recipient, input.idempotencyKey, input.caption, ctaUrl, image)
    }
    return this.sendContent(socket, input.recipient, input.idempotencyKey, createImageMessageContent(image, input.caption))
  }

  private requireConnectedSocket(): WASocket {
    if (!this.socket || this.state.status !== 'CONNECTED') {
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

  private async sendContent(socket: WASocket, recipient: string, idempotencyKey: string, content: AnyMessageContent): Promise<SendResult> {
    const jid = `${recipient}@s.whatsapp.net`
    const messageId = createStableMessageId(idempotencyKey)

    try {
      const result = await socket.sendMessage(jid, content, { messageId })
      if (!result?.key.id) {
        throw new MessagingProviderError('Provider tidak mengembalikan ID pesan', 'MISSING_MESSAGE_ID', true, true)
      }
      return { providerMessageId: result.key.id }
    } catch (error) {
      throw this.mapSendError(error)
    }
  }

  private async sendInteractiveCta(
    socket: WASocket,
    recipient: string,
    idempotencyKey: string,
    text: string,
    url: string,
    image?: RemoteImage,
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
      url,
      label: config.EXPERIMENTAL_CTA_LABEL,
      footer: config.EXPERIMENTAL_CTA_FOOTER,
      imageMessage,
    })

    try {
      const providerMessageId = await socket.relayMessage(jid, content, {
        messageId,
        additionalNodes: createInteractiveCtaRelayNodes(),
      })
      if (!providerMessageId) {
        throw new MessagingProviderError('Provider tidak mengembalikan ID pesan interaktif', 'MISSING_MESSAGE_ID', true, true)
      }
      return { providerMessageId }
    } catch (error) {
      throw this.mapSendError(error)
    }
  }

  private mapSendError(error: unknown): MessagingProviderError {
    if (error instanceof MessagingProviderError) return error
    const statusCode = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
    if (statusCode === 400 || statusCode === 404) {
      return new MessagingProviderError('Nomor WhatsApp ditolak provider', 'INVALID_RECIPIENT', false)
    }
    if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden) {
      return new MessagingProviderError('Session WhatsApp tidak lagi valid', 'PROVIDER_DISCONNECTED', true)
    }
    if (statusCode === DisconnectReason.connectionClosed
      || statusCode === DisconnectReason.connectionLost
      || statusCode === DisconnectReason.unavailableService) {
      return new MessagingProviderError('Koneksi WhatsApp terputus saat pengiriman', 'PROVIDER_DISCONNECTED', true, true)
    }
    return new MessagingProviderError('Pengiriman WhatsApp tidak terkonfirmasi', 'DELIVERY_UNCERTAIN', true, true)
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

  private async ensureAccount(): Promise<void> {
    await db.insert(whatsappAccounts).values({ id: ACCOUNT_ID }).onConflictDoNothing()
  }

  private async persistStatus(status: MessagingState['status']): Promise<void> {
    await db.update(whatsappAccounts).set({ status, updatedAt: new Date() }).where(eq(whatsappAccounts.id, ACCOUNT_ID))
  }
}
