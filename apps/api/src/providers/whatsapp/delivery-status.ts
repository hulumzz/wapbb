import { WAMessageStatus } from '@whiskeysockets/baileys'

export type DeliveryStatus = 'PENDING' | 'SERVER_ACK' | 'DELIVERED' | 'READ' | 'PLAYED' | 'ERROR' | 'UNKNOWN'

export function mapBaileysDeliveryStatus(status: number | null | undefined): DeliveryStatus | undefined {
  switch (status) {
    case WAMessageStatus.PENDING: return 'PENDING'
    case WAMessageStatus.SERVER_ACK: return 'SERVER_ACK'
    case WAMessageStatus.DELIVERY_ACK: return 'DELIVERED'
    case WAMessageStatus.READ: return 'READ'
    case WAMessageStatus.PLAYED: return 'PLAYED'
    case WAMessageStatus.ERROR: return 'ERROR'
    default: return undefined
  }
}

export function allowedPreviousDeliveryStatuses(next: DeliveryStatus): DeliveryStatus[] {
  switch (next) {
    case 'PENDING': return []
    case 'SERVER_ACK': return ['PENDING', 'UNKNOWN', 'ERROR']
    case 'DELIVERED': return ['PENDING', 'SERVER_ACK', 'UNKNOWN', 'ERROR']
    case 'READ': return ['PENDING', 'SERVER_ACK', 'DELIVERED', 'UNKNOWN', 'ERROR']
    case 'PLAYED': return ['PENDING', 'SERVER_ACK', 'DELIVERED', 'READ', 'UNKNOWN', 'ERROR']
    case 'ERROR': return ['PENDING', 'SERVER_ACK', 'UNKNOWN']
    case 'UNKNOWN': return ['PENDING', 'SERVER_ACK']
  }
}

export function confirmsSubmission(status: string | null | undefined): boolean {
  return status === 'SERVER_ACK' || status === 'DELIVERED' || status === 'READ' || status === 'PLAYED'
}
