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
