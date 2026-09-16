import assert from 'node:assert/strict'
import test from 'node:test'
import { WAMessageStatus } from '@whiskeysockets/baileys'
import { allowedPreviousDeliveryStatuses, confirmsSubmission, mapBaileysDeliveryStatus } from './delivery-status.js'

test('memetakan acknowledgement Baileys ke status pengantaran', () => {
  assert.equal(mapBaileysDeliveryStatus(WAMessageStatus.SERVER_ACK), 'SERVER_ACK')
  assert.equal(mapBaileysDeliveryStatus(WAMessageStatus.DELIVERY_ACK), 'DELIVERED')
  assert.equal(mapBaileysDeliveryStatus(WAMessageStatus.READ), 'READ')
  assert.equal(mapBaileysDeliveryStatus(999), undefined)
})

test('status delivery hanya maju dan receipt mengonfirmasi submission', () => {
  assert.deepEqual(allowedPreviousDeliveryStatuses('DELIVERED'), ['PENDING', 'SERVER_ACK', 'UNKNOWN', 'ERROR'])
  assert.equal(confirmsSubmission('SERVER_ACK'), true)
  assert.equal(confirmsSubmission('PENDING'), false)
  assert.equal(confirmsSubmission('UNKNOWN'), false)
})
