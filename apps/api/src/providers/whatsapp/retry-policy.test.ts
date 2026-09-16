import assert from 'node:assert/strict'
import test from 'node:test'
import { MessagingProviderError } from './types.js'
import { shouldRetryAutomatically } from './retry-policy.js'

test('mengulang error sementara yang dipastikan belum terkirim', () => {
  const error = new MessagingProviderError('lookup gagal', 'PROVIDER_LOOKUP_FAILED', true)
  assert.equal(shouldRetryAutomatically(error, 1, 3), true)
})

test('tidak mengulang otomatis ketika hasil pengiriman tidak pasti', () => {
  const error = new MessagingProviderError('koneksi putus', 'DELIVERY_UNCERTAIN', true, true)
  assert.equal(shouldRetryAutomatically(error, 1, 3), false)
})

test('menghormati batas maksimum percobaan', () => {
  const error = new MessagingProviderError('sementara', 'TEMPORARY', true)
  assert.equal(shouldRetryAutomatically(error, 3, 3), false)
})
