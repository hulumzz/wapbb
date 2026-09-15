import { createHash, timingSafeEqual } from 'node:crypto'

export function safeSecretEqual(left: string | undefined, right: string): boolean {
  if (!left) return false
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}
