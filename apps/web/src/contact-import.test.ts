import assert from 'node:assert/strict'
import test from 'node:test'
import { mapContactRows, parseCsv } from './contact-import.js'

test('membaca CSV berkoma, bertitik-koma, dan nilai dengan tanda kutip', () => {
  assert.deepEqual(parseCsv('Nama Lengkap,Nomor WhatsApp\n"Ahmad, Fauzi",08123456789'), [
    ['Nama Lengkap', 'Nomor WhatsApp'],
    ['Ahmad, Fauzi', '08123456789'],
  ])
  assert.deepEqual(parseCsv('Nama Lengkap;Nomor WhatsApp\nBudi;081298765432'), [
    ['Nama Lengkap', 'Nomor WhatsApp'],
    ['Budi', '081298765432'],
  ])
})

test('memetakan header umum dan memakai opt-out sebagai default aman', () => {
  const rows = mapContactRows([
    ['Nama Penerima', 'No. WhatsApp', 'Bersedia'],
    ['Ahmad', '08123456789', 'Ya'],
    ['Budi', '081298765432', ''],
  ])

  assert.equal(rows[0]?.whatsappOptIn, true)
  assert.equal(rows[1]?.whatsappOptIn, false)
  assert.equal(rows[1]?.rowNumber, 3)
})

test('menolak header wajib yang hilang dan CSV tidak lengkap', () => {
  assert.throws(() => mapContactRows([['Nama'], ['Ahmad']]), /Header wajib/)
  assert.throws(() => parseCsv('Nama Lengkap,Nomor WhatsApp\n"Ahmad,08123'), /tanda kutip/)
})
