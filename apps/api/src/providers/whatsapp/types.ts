export type MessagingStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED' | 'NEEDS_REAUTH'

export type MessagingState = {
  status: MessagingStatus
  phoneNumber: string | null
  qrDataUrl: string | null
  reason?: string | null
  changedAt?: string
  authPersistence?: 'healthy' | 'degraded'
}

export type SendTextInput = {
  recipient: string
  text: string
  idempotencyKey: string
  interactiveCta?: InteractiveCta
  deadline?: number
  beforeRelay?: () => Promise<void>
}

export type SendImageInput = {
  recipient: string
  imageUrl: string
  caption: string
  idempotencyKey: string
  interactiveCta?: InteractiveCta
  deadline?: number
  beforeRelay?: () => Promise<void>
}

export type InteractiveCta = {
  url: string
  label: string
  footer: string
}

export type SendResult = {
  providerMessageId: string
}

export class MessagingProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly deliveryUncertain = false,
  ) {
    super(message)
    this.name = 'MessagingProviderError'
  }
}

export interface MessagingProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  replaceAccount(): Promise<void>
  getStatus(): Promise<MessagingState>
  sendText(input: SendTextInput): Promise<SendResult>
  sendImage(input: SendImageInput): Promise<SendResult>
}
