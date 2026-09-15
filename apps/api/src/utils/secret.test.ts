import assert from 'node:assert/strict'
import test from 'node:test'
import { safeSecretEqual } from './secret.js'

test('membandingkan bearer secret tanpa perbandingan string langsung', () => {
  assert.equal(safeSecretEqual('Bearer secret-value', 'Bearer secret-value'), true)
  assert.equal(safeSecretEqual('Bearer wrong', 'Bearer secret-value'), false)
  assert.equal(safeSecretEqual(undefined, 'Bearer secret-value'), false)
})
