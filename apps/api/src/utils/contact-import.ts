import { normalizeIndonesianPhone } from './phone.js'

export type ContactImportRow = {
  sheetName?: string
  rowNumber: number
  fullName: string
  phone: string
  whatsappOptIn: boolean
}

export type ContactImportIssue = {
  sheetName?: string
  rowNumber: number
  kind: 'INVALID' | 'DUPLICATE'
  message: string
}

export function prepareContactImportRows(rows: ContactImportRow[]) {
  const valid: Array<ContactImportRow & { phoneNormalized: string }> = []
  const issues: ContactImportIssue[] = []
  const firstRowByPhone = new Map<string, { rowNumber: number; sheetName?: string }>()
  let invalid = 0
  let duplicateWithinFile = 0
  let skipped = 0

  for (const row of rows) {
    const fullName = row.fullName.trim()
    const phone = row.phone.trim()

    if (!fullName || !phone) {
      skipped += 1
      continue
    }

    if (fullName.length < 2 || fullName.length > 120) {
      invalid += 1
      issues.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, kind: 'INVALID', message: 'Nama harus terdiri dari 2-120 karakter.' })
      continue
    }

    let phoneNormalized: string
    try {
      phoneNormalized = normalizeIndonesianPhone(phone)
    } catch (error) {
      invalid += 1
      issues.push({
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        kind: 'INVALID',
        message: error instanceof Error ? error.message : 'Nomor WhatsApp tidak valid.',
      })
      continue
    }

    const firstRow = firstRowByPhone.get(phoneNormalized)
    if (firstRow) {
      duplicateWithinFile += 1
      issues.push({
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        kind: 'DUPLICATE',
        message: `Nomor sama dengan ${firstRow.sheetName ? `sheet ${firstRow.sheetName}, ` : ''}baris ${firstRow.rowNumber}.`,
      })
      continue
    }

    firstRowByPhone.set(phoneNormalized, { rowNumber: row.rowNumber, sheetName: row.sheetName })
    valid.push({ ...row, fullName, phone, phoneNormalized })
  }

  return { valid, issues, invalid, duplicateWithinFile, skipped }
}
