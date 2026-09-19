import assert from 'node:assert/strict'
import test from 'node:test'
import { mapContactRows, mapContactSheets, parseCsv } from './contact-import.js'

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

test('memetakan header umum dan memakai opt-in sebagai default', () => {
  const rows = mapContactRows([
    ['Nama Penerima', 'No. WhatsApp', 'Bersedia'],
    ['Ahmad', '08123456789', 'Ya'],
    ['Budi', '081298765432', ''],
    ['Cici', '081277766655', 'Tidak'],
  ])

  assert.equal(rows[0]?.whatsappOptIn, true)
  assert.equal(rows[1]?.whatsappOptIn, true)
  assert.equal(rows[1]?.rowNumber, 3)
  assert.equal(rows[2]?.whatsappOptIn, false)
})

test('melewati baris tanpa nama, tanpa nomor, atau panjang nomor di luar 10-14 digit', () => {
  const rows = mapContactRows([
    ['Nama Lengkap', 'Nomor WhatsApp'],
    ['', '081234567890'],
    ['Tanpa Nomor', ''],
    ['Terlalu Pendek', '081234567'],
    ['Valid Minimum', '0812345678'],
    ['Valid Maksimum', '08123456789012'],
    ['Terlalu Panjang', '081234567890123'],
  ])

  assert.deepEqual(rows.map((row) => row.fullName), ['Valid Minimum', 'Valid Maksimum'])
  assert.ok(rows.every((row) => row.whatsappOptIn))
})

test('menggabungkan semua sheet kontak dan melewati sheet tanpa header kontak', () => {
  const result = mapContactSheets([
    { sheet: 'Petunjuk', data: [['Cara menggunakan template']] },
    { sheet: 'Dusun A', data: [['Nama Lengkap', 'Nomor WhatsApp'], ['Ahmad', '081234567890']] },
    { sheet: 'Dusun B', data: [['Nama', 'No HP', 'Opt In'], ['Budi', '081298765432', 'Tidak']] },
  ])

  assert.deepEqual(result.sheetNames, ['Dusun A', 'Dusun B'])
  assert.deepEqual(result.rows.map((row) => row.sheetName), ['Dusun A', 'Dusun B'])
  assert.equal(result.rows[0]?.whatsappOptIn, true)
  assert.equal(result.rows[1]?.whatsappOptIn, false)
})

test('menolak header wajib yang hilang dan CSV tidak lengkap', () => {
  assert.throws(() => mapContactRows([['Nama'], ['Ahmad']]), /Header wajib/)
  assert.throws(() => parseCsv('Nama Lengkap,Nomor WhatsApp\n"Ahmad,08123'), /tanda kutip/)
})
