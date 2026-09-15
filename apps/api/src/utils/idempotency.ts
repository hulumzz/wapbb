import { createHash } from 'node:crypto'

export function createStableMessageId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32).toUpperCase()
}
