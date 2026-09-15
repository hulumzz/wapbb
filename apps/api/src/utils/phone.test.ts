import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIndonesianPhone } from './phone.js'

test('menormalisasi format nomor Indonesia yang didukung', () => {
  assert.equal(normalizeIndonesianPhone('0812 3456-789'), '628123456789')
  assert.equal(normalizeIndonesianPhone('8123456789'), '628123456789')
  assert.equal(normalizeIndonesianPhone('+628123456789'), '628123456789')
  assert.equal(normalizeIndonesianPhone('(0812) 3456.789'), '628123456789')
})

test('menolak nomor non-Indonesia dan karakter tak valid', () => {
  assert.throws(() => normalizeIndonesianPhone('+12025550123'), /tidak valid/)
  assert.throws(() => normalizeIndonesianPhone('0812abc456'), /tidak valid/)
})
