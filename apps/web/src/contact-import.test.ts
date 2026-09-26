import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { mapContactRows, mapContactSheets, parseContactFile, parseCsv } from './contact-import.js'

function makeWorkbook(sheets: Array<{ name: string; rows: string[][] }>) {
  const xml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
  const files: Record<string, Uint8Array> = {}
  const sheetEntries = sheets.map(({ name }, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
  const sheetTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  files['[Content_Types].xml'] = strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetTypes}</Types>`)
  files['_rels/.rels'] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`)
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`)
  for (const [index, sheet] of sheets.entries()) {
    const rows = sheet.rows.map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells.map((value, columnIndex) => `<c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`).join('')
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`)
  }
  const archive = zipSync(files)
  return new File([Uint8Array.from(archive).buffer], 'kontak.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

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

test('mengenali header Excel dengan penanda wajib dan singkatan WA', () => {
  const rows = mapContactRows([['Nama Lengkap *', 'No. WA (wajib)'], ['Ahmad', '081234567890']])
  assert.equal(rows[0]?.fullName, 'Ahmad')
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
  assert.deepEqual(result.ignoredSheets, [{ sheetName: 'Petunjuk', reason: 'header Nama Lengkap dan Nomor WhatsApp tidak ditemukan di awal sheet' }])
})

test('membaca data baru pada sheet kelima meski header bergeser dari baris pertama', () => {
  const result = mapContactSheets([
    { sheet: 'Dusun 1', data: [['Nama Lengkap', 'Nomor WhatsApp'], ['Satu', '081234567801']] },
    { sheet: 'Dusun 2', data: [['Nama Lengkap', 'Nomor WhatsApp'], ['Dua', '081234567802']] },
    { sheet: 'Petunjuk', data: [['Isi nama dan nomor penerima']] },
    { sheet: 'Belum Diisi', data: [] },
    { sheet: 'Dusun 5', data: [[], ['Daftar penerima'], ['Nama Lengkap', 'Nomor WhatsApp'], ['Lima', '081234567805']] },
  ])

  assert.deepEqual(result.sheetNames, ['Dusun 1', 'Dusun 2', 'Dusun 5'])
  assert.deepEqual(result.rows.map(({ fullName, sheetName, rowNumber }) => [fullName, sheetName, rowNumber]), [
    ['Satu', 'Dusun 1', 2], ['Dua', 'Dusun 2', 2], ['Lima', 'Dusun 5', 4],
  ])
  assert.deepEqual(result.sheetSummaries.map(({ sheetName, headerRow, ready }) => [sheetName, headerRow, ready]), [
    ['Dusun 1', 1, 1], ['Dusun 2', 1, 1], ['Dusun 5', 3, 1],
  ])
  assert.deepEqual(result.ignoredSheets.map(({ sheetName, reason }) => [sheetName, reason]), [
    ['Petunjuk', 'header Nama Lengkap dan Nomor WhatsApp tidak ditemukan di awal sheet'],
    ['Belum Diisi', 'sheet kosong'],
  ])
})

test('membaca workbook XLSX asli dengan lima sheet melalui alur unggah browser', async () => {
  const file = makeWorkbook([
    { name: 'Dusun 1', rows: [['Nama Lengkap', 'Nomor WhatsApp'], ['Satu', '081234567801']] },
    { name: 'Dusun 2', rows: [['Nama Lengkap', 'Nomor WhatsApp'], ['Dua', '081234567802']] },
    { name: 'Petunjuk', rows: [['Cara mengisi kontak']] },
    { name: 'Masih Kosong', rows: [] },
    { name: 'Dusun 5', rows: [[], ['Daftar baru'], ['Nama Lengkap', 'Nomor WhatsApp'], ['Lima', '081234567805']] },
  ])

  const result = await parseContactFile(file)
  assert.deepEqual(result.rows.map(({ fullName, sheetName, rowNumber }) => [fullName, sheetName, rowNumber]), [
    ['Satu', 'Dusun 1', 2], ['Dua', 'Dusun 2', 2], ['Lima', 'Dusun 5', 4],
  ])
  assert.deepEqual(result.ignoredSheets.map(({ sheetName }) => sheetName), ['Petunjuk', 'Masih Kosong'])
})

test('menolak header wajib yang hilang dan CSV tidak lengkap', () => {
  assert.throws(() => mapContactRows([['Nama'], ['Ahmad']]), /Header wajib/)
  assert.throws(() => parseCsv('Nama Lengkap,Nomor WhatsApp\n"Ahmad,08123'), /tanda kutip/)
})
