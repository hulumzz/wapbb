import assert from 'node:assert/strict'
import test from 'node:test'
import { createStableMessageId } from './idempotency.js'

test('menghasilkan message ID provider stabil per job', () => {
  const first = createStableMessageId('f8916fde-bb62-45fd-a5c5-419a03408657')
  const retry = createStableMessageId('f8916fde-bb62-45fd-a5c5-419a03408657')
  const other = createStableMessageId('f8916fde-bb62-45fd-a5c5-419a03408658')

  assert.equal(first, retry)
  assert.notEqual(first, other)
  assert.match(first, /^[A-F0-9]{32}$/)
})
