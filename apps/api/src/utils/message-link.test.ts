import assert from 'node:assert/strict'
import test from 'node:test'
import { extractHttpsUrl } from './message-link.js'

test('mengambil URL HTTPS pertama dari pesan', () => {
  assert.equal(
    extractHttpsUrl('Buka https://desa.example/informasi?id=123 sekarang.'),
    'https://desa.example/informasi?id=123',
  )
})

test('mengabaikan pesan tanpa URL HTTPS publik', () => {
  assert.equal(extractHttpsUrl('Pesan biasa tanpa tautan'), undefined)
  assert.equal(extractHttpsUrl('Buka http://localhost:3000'), undefined)
})
