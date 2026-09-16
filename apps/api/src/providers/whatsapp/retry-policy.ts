import type { MessagingProviderError } from './types.js'

export function shouldRetryAutomatically(error: MessagingProviderError, attempts: number, maxAttempts: number): boolean {
  return error.retryable && !error.deliveryUncertain && attempts < maxAttempts
}
