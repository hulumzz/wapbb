export type MessagingStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED' | 'NEEDS_REAUTH'

export type MessagingState = {
  status: MessagingStatus
  phoneNumber: string | null
  qrDataUrl: string | null
}

export type SendTextInput = {
  recipient: string
  text: string
}

export type SendResult = {
  providerMessageId: string | null
}

export interface MessagingProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<MessagingState>
  sendText(input: SendTextInput): Promise<SendResult>
}
