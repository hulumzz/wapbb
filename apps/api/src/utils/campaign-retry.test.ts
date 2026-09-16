import test from 'node:test'
import assert from 'node:assert/strict'
import { canRetryCampaignJob, shouldResumeCampaign } from './campaign-retry.js'

test('campaign selesai dibuka kembali saat job gagal di-retry', () => {
  assert.equal(shouldResumeCampaign('COMPLETED'), true)
  assert.equal(shouldResumeCampaign('RUNNING'), false)
  assert.equal(shouldResumeCampaign('CANCELLED'), false)
})

test('hanya job gagal atau delivery tidak pasti yang dapat di-retry', () => {
  assert.equal(canRetryCampaignJob('FAILED', 'ERROR'), true)
  assert.equal(canRetryCampaignJob('FAILED', 'UNKNOWN'), true)
  assert.equal(canRetryCampaignJob('SENT', 'UNKNOWN'), true)
  assert.equal(canRetryCampaignJob('SENT', 'DELIVERED'), false)
  assert.equal(canRetryCampaignJob('QUEUED', null), false)
})