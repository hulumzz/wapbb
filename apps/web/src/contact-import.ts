export type ContactImportRow = {
  rowNumber: number
  fullName: string
  phone: string
  whatsappOptIn: boolean
}

type Cell = string | number | boolean | Date | typeof Date | null | undefined

const NAME_HEADERS = new Set(['nama', 'nama lengkap', 'nama penerima', 'name', 'full name'])
const PHONE_HEADERS = new Set(['nomor', 'nomor whatsapp', 'no whatsapp', 'nomor telepon', 'no telepon', 'nomor hp', 'no hp', 'telepon', 'telp', 'phone', 'telephone', 'whatsapp'])
const OPT_IN_HEADERS = new Set(['opt in', 'whatsapp opt in', 'izin whatsapp', 'bersedia'])

function normalizeHeader(value: Cell) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[_.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellText(value: Cell) {
  if (value instanceof Date) return value.toISOString()
  return String(value ?? '').trim()
}

function optInValue(value: Cell) {
  const normalized = normalizeHeader(value)
  return ['ya', 'yes', 'true', '1', 'setuju', 'bersedia', 'opt in', 'optin'].includes(normalized)
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index]
    if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') commas += 1
    else if (!quoted && char === ';') semicolons += 1
  }
  return semicolons > commas ? ';' : ','
}

export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && quoted && next === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(value)
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  if (quoted) throw new Error('Format CSV tidak valid: tanda kutip belum ditutup.')
  return rows
}

export function mapContactRows(rows: Cell[][]): ContactImportRow[] {
  if (!rows.length) throw new Error('File tidak berisi data.')
  const headers = rows[0].map(normalizeHeader)
  const nameIndex = headers.findIndex((header) => NAME_HEADERS.has(header))
  const phoneIndex = headers.findIndex((header) => PHONE_HEADERS.has(header))
  const optInIndex = headers.findIndex((header) => OPT_IN_HEADERS.has(header))

  if (nameIndex < 0 || phoneIndex < 0) {
    throw new Error('Header wajib tidak ditemukan. Gunakan kolom "Nama Lengkap" dan "Nomor WhatsApp".')
  }

  const result = rows.slice(1).flatMap((row, index) => {
    const fullName = cellText(row[nameIndex])
    const phone = cellText(row[phoneIndex])
    if (!fullName && !phone) return []
    return [{
      rowNumber: index + 2,
      fullName,
      phone,
      whatsappOptIn: optInIndex < 0 ? false : optInValue(row[optInIndex]),
    }]
  })

  if (!result.length) throw new Error('Tidak ada baris kontak di bawah header.')
  if (result.length > 1000) throw new Error('Maksimal 1.000 baris per file impor.')
  return result
}

export async function parseContactFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') return mapContactRows(parseCsv(await file.text()))
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser')
    return mapContactRows(await readSheet(file))
  }
  throw new Error('Format belum didukung. Pilih file .csv atau .xlsx.')
}
