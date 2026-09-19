export type ContactImportRow = {
  sheetName?: string
  rowNumber: number
  fullName: string
  phone: string
  whatsappOptIn: boolean
}

export type ContactImportParseResult = {
  rows: ContactImportRow[]
  skipped: number
  sheetNames: string[]
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
  if (!normalized) return true
  if (['tidak', 'no', 'false', '0', 'tidak setuju', 'menolak', 'opt out', 'optout'].includes(normalized)) return false
  return ['ya', 'yes', 'true', '1', 'setuju', 'bersedia', 'opt in', 'optin'].includes(normalized)
}

function phoneDigitCount(value: string) {
  return value.replace(/\D/g, '').length
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

function headerIndexes(rows: Cell[][]) {
  const headers = (rows[0] ?? []).map(normalizeHeader)
  return {
    nameIndex: headers.findIndex((header) => NAME_HEADERS.has(header)),
    phoneIndex: headers.findIndex((header) => PHONE_HEADERS.has(header)),
    optInIndex: headers.findIndex((header) => OPT_IN_HEADERS.has(header)),
  }
}

function mapRows(rows: Cell[][], sheetName?: string) {
  if (!rows.length) throw new Error('File tidak berisi data.')
  const { nameIndex, phoneIndex, optInIndex } = headerIndexes(rows)

  if (nameIndex < 0 || phoneIndex < 0) {
    throw new Error('Header wajib tidak ditemukan. Gunakan kolom "Nama Lengkap" dan "Nomor WhatsApp".')
  }

  let skipped = 0
  let sourceRows = 0
  const result = rows.slice(1).flatMap((row, index) => {
    if (!row.some((cell) => cellText(cell))) return []
    sourceRows += 1
    const fullName = cellText(row[nameIndex])
    const phone = cellText(row[phoneIndex])
    const digitCount = phoneDigitCount(phone)
    if (!fullName || !phone || digitCount < 10 || digitCount > 14) {
      skipped += 1
      return []
    }
    return [{
      sheetName,
      rowNumber: index + 2,
      fullName,
      phone,
      whatsappOptIn: optInIndex < 0 ? true : optInValue(row[optInIndex]),
    }]
  })

  return { rows: result, skipped, sourceRows }
}

export function mapContactRows(rows: Cell[][]): ContactImportRow[] {
  const result = mapRows(rows)

  if (result.sourceRows > 1000) throw new Error('Maksimal 1.000 baris per file impor.')
  if (!result.rows.length) throw new Error('Tidak ada baris dengan nama dan nomor WhatsApp yang valid.')
  return result.rows
}

export function mapContactSheets(sheets: Array<{ sheet: string; data: Cell[][] }>): ContactImportParseResult {
  const contactSheets = sheets.filter(({ data }) => {
    const { nameIndex, phoneIndex } = headerIndexes(data)
    return nameIndex >= 0 && phoneIndex >= 0
  })

  if (!contactSheets.length) {
    throw new Error('Tidak ada sheet dengan header "Nama Lengkap" dan "Nomor WhatsApp".')
  }

  const mapped = contactSheets.map(({ sheet, data }) => mapRows(data, sheet))
  const sourceRows = mapped.reduce((total, item) => total + item.sourceRows, 0)
  const rows = mapped.flatMap((item) => item.rows)
  if (sourceRows > 1000) throw new Error('Maksimal 1.000 baris untuk total seluruh sheet kontak.')
  if (!rows.length) throw new Error('Tidak ada baris dengan nama dan nomor WhatsApp yang valid.')

  return {
    rows,
    skipped: mapped.reduce((total, item) => total + item.skipped, 0),
    sheetNames: contactSheets.map(({ sheet }) => sheet),
  }
}

export async function parseContactFile(file: File): Promise<ContactImportParseResult> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') {
    const parsed = parseCsv(await file.text())
    const mapped = mapRows(parsed)
    if (mapped.sourceRows > 1000) throw new Error('Maksimal 1.000 baris per file impor.')
    if (!mapped.rows.length) throw new Error('Tidak ada baris dengan nama dan nomor WhatsApp yang valid.')
    return { rows: mapped.rows, skipped: mapped.skipped, sheetNames: [] }
  }
  if (extension === 'xlsx') {
    const { default: readExcelFile } = await import('read-excel-file/browser')
    return mapContactSheets(await readExcelFile(file))
  }
  throw new Error('Format belum didukung. Pilih file .csv atau .xlsx.')
}
