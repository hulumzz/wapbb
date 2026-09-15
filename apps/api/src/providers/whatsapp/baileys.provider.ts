import makeWASocket, { DisconnectReason, type WASocket } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { whatsappAccounts } from '../../db/schema.js'
import { createSqlAuthState, hasStoredAuthState } from './sql-auth-state.js'
import type { MessagingProvider, MessagingState, SendTextInput, SendResult } from './types.js'

const ACCOUNT_ID = 'default'

export class BaileysProvider implements MessagingProvider {
  private socket: WASocket | null = null
  private state: MessagingState = {
    status: 'DISCONNECTED',
    phoneNumber: null,
    qrDataUrl: null,
  }
  private connecting: Promise<void> | null = null

  async restore(): Promise<void> {
    await this.ensureAccount()
    if (await hasStoredAuthState(ACCOUNT_ID)) await this.connect()
  }

  async connect(): Promise<void> {
    if (this.state.status === 'CONNECTED' || this.state.status === 'CONNECTING') return
    if (this.connecting) return this.connecting

    this.connecting = this.openSocket().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async openSocket(): Promise<void> {
    await this.ensureAccount()
    this.state = { ...this.state, status: 'CONNECTING', qrDataUrl: null }
    await this.persistStatus('CONNECTING')

    const { state, saveCreds } = await createSqlAuthState(ACCOUNT_ID)
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('connection.update', async (update) => {
      if (update.qr) {
        const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 })
        this.state = { ...this.state, status: 'QR_READY', qrDataUrl }
        await this.persistStatus('QR_READY')
      }

      if (update.connection === 'open') {
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
        const loggedOut = statusCode === DisconnectReason.loggedOut
        this.socket = null
        this.state = {
          status: loggedOut ? 'NEEDS_REAUTH' : 'DISCONNECTED',
          phoneNumber: this.state.phoneNumber,
          qrDataUrl: null,
        }
        await this.persistStatus(this.state.status)
      }
    })
  }

  async disconnect(): Promise<void> {
    this.socket?.end(undefined)
    this.socket = null
    this.state = { ...this.state, status: 'DISCONNECTED', qrDataUrl: null }
    await this.persistStatus('DISCONNECTED')
  }

  async getStatus(): Promise<MessagingState> {
    return this.state
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    if (!this.socket || this.state.status !== 'CONNECTED') {
      throw new Error('WhatsApp belum terhubung')
    }

    const jid = `${input.recipient}@s.whatsapp.net`
    const result = await this.socket.sendMessage(jid, { text: input.text })
    return { providerMessageId: result?.key.id ?? null }
  }

  private async ensureAccount(): Promise<void> {
    await db.insert(whatsappAccounts).values({ id: ACCOUNT_ID }).onConflictDoNothing()
  }

  private async persistStatus(status: MessagingState['status']): Promise<void> {
    await db.update(whatsappAccounts).set({ status, updatedAt: new Date() }).where(eq(whatsappAccounts.id, ACCOUNT_ID))
  }
}
