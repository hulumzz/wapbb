import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SerialWrites } from './serial-writes.js'
test('writes are ordered, recover after rejection, and stop prevents resurrection', async () => {
  const queue = new SerialWrites(), calls: number[] = []
  const first = queue.run(async () => { calls.push(1); throw new Error('temporary') })
  const second = queue.run(async () => { calls.push(2) })
  await assert.rejects(first); await second; await queue.stop()
  await assert.rejects(queue.run(async () => { calls.push(3) }))
  assert.deepEqual(calls, [1, 2])
})
