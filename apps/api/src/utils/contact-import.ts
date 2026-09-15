import { normalizeIndonesianPhone } from './phone.js'

export type ContactImportRow = {
  rowNumber: number
  fullName: string
  phone: string
  whatsappOptIn: boolean
}

export type ContactImportIssue = {
  rowNumber: number
  kind: 'INVALID' | 'DUPLICATE'
  message: string
}

export function prepareContactImportRows(rows: ContactImportRow[]) {
  const valid: Array<ContactImportRow & { phoneNormalized: string }> = []
  const issues: ContactImportIssue[] = []
  const firstRowByPhone = new Map<string, number>()
  let invalid = 0
  let duplicateWithinFile = 0

  for (const row of rows) {
    const fullName = row.fullName.trim()
    const phone = row.phone.trim()

    if (fullName.length < 2 || fullName.length > 120) {
      invalid += 1
      issues.push({ rowNumber: row.rowNumber, kind: 'INVALID', message: 'Nama harus terdiri dari 2-120 karakter.' })
      continue
    }

    let phoneNormalized: string
    try {
      phoneNormalized = normalizeIndonesianPhone(phone)
    } catch (error) {
      invalid += 1
      issues.push({
        rowNumber: row.rowNumber,
        kind: 'INVALID',
        message: error instanceof Error ? error.message : 'Nomor WhatsApp tidak valid.',
      })
      continue
    }

    const firstRow = firstRowByPhone.get(phoneNormalized)
    if (firstRow !== undefined) {
      duplicateWithinFile += 1
      issues.push({
        rowNumber: row.rowNumber,
        kind: 'DUPLICATE',
        message: `Nomor sama dengan baris ${firstRow}.`,
      })
      continue
    }

    firstRowByPhone.set(phoneNormalized, row.rowNumber)
    valid.push({ ...row, fullName, phone, phoneNormalized })
  }

  return { valid, issues, invalid, duplicateWithinFile }
}
