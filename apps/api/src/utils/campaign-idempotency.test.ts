import assert from 'node:assert/strict'
import test from 'node:test'
import { createCampaignRequestHash } from './campaign-idempotency.js'

const base = {
  name: 'Informasi Desa',
  templateId: 'template-1',
  batchSize: 10,
  useBanner: true,
  useInteractiveCta: true,
}

test('hash campaign stabil untuk urutan dan duplikasi kontak', () => {
  assert.equal(
    createCampaignRequestHash({ ...base, contactIds: ['b', 'a', 'a'] }),
    createCampaignRequestHash({ ...base, contactIds: ['a', 'b'] }),
  )
})

test('hash campaign berubah jika payload berubah', () => {
  assert.notEqual(
    createCampaignRequestHash({ ...base, contactIds: ['a'] }),
    createCampaignRequestHash({ ...base, contactIds: ['b'] }),
  )
})
