import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareContactImportRows } from './contact-import.js'

test('menyiapkan kontak valid dan menormalisasi nomor', () => {
  const result = prepareContactImportRows([
    { rowNumber: 2, fullName: '  Ahmad Fauzi  ', phone: '0812 3456 789', whatsappOptIn: true },
  ])

  assert.equal(result.valid.length, 1)
  assert.equal(result.valid[0]?.fullName, 'Ahmad Fauzi')
  assert.equal(result.valid[0]?.phoneNormalized, '628123456789')
  assert.equal(result.invalid, 0)
})

test('memisahkan baris invalid dan duplikat di dalam file', () => {
  const result = prepareContactImportRows([
    { rowNumber: 2, fullName: 'A', phone: '08123456789', whatsappOptIn: true },
    { rowNumber: 3, fullName: 'Budi', phone: '08123456789', whatsappOptIn: true },
    { rowNumber: 4, fullName: 'Budi Lagi', phone: '+628123456789', whatsappOptIn: false },
    { rowNumber: 5, fullName: 'Cici', phone: 'bukan nomor', whatsappOptIn: true },
  ])

  assert.equal(result.valid.length, 1)
  assert.equal(result.invalid, 2)
  assert.equal(result.duplicateWithinFile, 1)
  assert.deepEqual(result.issues.map((issue) => issue.kind), ['INVALID', 'DUPLICATE', 'INVALID'])
})

test('melewati baris tanpa nama atau nomor dan mempertahankan lokasi sheet', () => {
  const result = prepareContactImportRows([
    { sheetName: 'Dusun A', rowNumber: 2, fullName: '', phone: '081234567890', whatsappOptIn: true },
    { sheetName: 'Dusun A', rowNumber: 3, fullName: 'Tanpa Nomor', phone: '', whatsappOptIn: true },
    { sheetName: 'Dusun B', rowNumber: 2, fullName: 'Valid', phone: '081298765432', whatsappOptIn: true },
    { sheetName: 'Dusun C', rowNumber: 4, fullName: 'Duplikat', phone: '+6281298765432', whatsappOptIn: true },
  ])

  assert.equal(result.skipped, 2)
  assert.equal(result.valid.length, 1)
  assert.equal(result.duplicateWithinFile, 1)
  assert.equal(result.issues[0]?.sheetName, 'Dusun C')
  assert.match(result.issues[0]?.message ?? '', /sheet Dusun B, baris 2/)
})
