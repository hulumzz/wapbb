import { ChangeEvent, useRef, useState } from 'react'
import { api } from './api'
import { ContactImportParseResult, ContactImportRow, parseContactFile } from './contact-import'

type ImportIssue = { sheetName?: string; rowNumber: number; kind: 'INVALID' | 'DUPLICATE'; message: string }
type ImportResult = { received: number; imported: number; duplicates: number; invalid: number; skipped: number; issues: ImportIssue[] }

export function ContactImportPanel({ onImported, notify }: { onImported: () => Promise<void>; notify: (message: string) => void }) {
  const [rows, setRows] = useState<ContactImportRow[]>([])
  const [skipped, setSkipped] = useState(0)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [sheetSummaries, setSheetSummaries] = useState<ContactImportParseResult['sheetSummaries']>([])
  const [ignoredSheets, setIgnoredSheets] = useState<ContactImportParseResult['ignoredSheets']>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const selectionId = useRef(0)

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    event.currentTarget.value = ''
    const currentSelection = ++selectionId.current
    setReading(false)
    setError('')
    setResult(null)
    setRows([])
    setSkipped(0)
    setSheetNames([])
    setSheetSummaries([])
    setIgnoredSheets([])
    setFileName(file.name)
    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran file maksimal 5 MB.')
      setInputKey((value) => value + 1)
      return
    }

    setReading(true)
    try {
      const parsed = await parseContactFile(file)
      if (currentSelection !== selectionId.current) return
      setRows(parsed.rows)
      setSkipped(parsed.skipped)
      setSheetNames(parsed.sheetNames)
      setSheetSummaries(parsed.sheetSummaries)
      setIgnoredSheets(parsed.ignoredSheets)
    } catch (caught) {
      if (currentSelection !== selectionId.current) return
      setError(caught instanceof Error ? caught.message : 'File tidak dapat dibaca.')
      setInputKey((value) => value + 1)
    } finally {
      if (currentSelection === selectionId.current) setReading(false)
    }
  }

  async function submitImport() {
    if (!rows.length || importing) return
    setImporting(true)
    setError('')
    try {
      const response = await api<ImportResult>('/api/contacts/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      })
      setResult(response)
      await onImported()
      notify(`${response.imported} kontak berhasil diimpor`)
      setRows([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impor kontak gagal.')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    selectionId.current += 1
    setRows([])
    setSkipped(0)
    setSheetNames([])
    setSheetSummaries([])
    setIgnoredSheets([])
    setFileName('')
    setError('')
    setResult(null)
    setReading(false)
    setInputKey((value) => value + 1)
  }

  return <div className="import-panel">
    <div className="import-intro">
      <div><p className="eyebrow">IMPOR MASSAL</p><h3>Tambahkan dari Excel atau CSV</h3><p>Kolom wajib: <strong>Nama Lengkap</strong> dan <strong>Nomor WhatsApp</strong>. Opt-in kosong memakai nilai <strong>Ya</strong>; pastikan semua penerima memang sudah memberikan persetujuan.</p></div>
      <a className="text-button" download="template-kontak.csv" href={'data:text/csv;charset=utf-8,' + encodeURIComponent('Nama Lengkap,Nomor WhatsApp,Opt In\nAhmad Fauzi,081234567890,Ya\n')}>Unduh contoh CSV</a>
    </div>
    <label className={`file-drop ${rows.length ? 'ready' : ''}`}>
      <input key={inputKey} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} />
      <span className="upload-icon">FILE</span>
      <strong>{reading ? 'Membaca file...' : fileName || 'Pilih file kontak'}</strong>
      <small>CSV/XLSX | maksimal 1.000 baris | 5 MB</small>
    </label>
    {error && <div className="inline-alert danger">{error}</div>}
    {!!rows.length && <>
      <div className="import-summary"><strong>{rows.length}</strong><span>baris siap diperiksa server{skipped ? ` · ${skipped} baris dilewati` : ''}{sheetNames.length > 1 ? ` · ${sheetNames.length} sheet kontak` : ''}</span></div>
      {!!sheetSummaries.length && <div className="import-sheet-report">
        <strong>Sheet yang terbaca</strong>
        <ul>{sheetSummaries.map((sheet) => <li key={sheet.sheetName}>{sheet.sheetName}: {sheet.ready} baris siap{sheet.skipped ? `, ${sheet.skipped} dilewati` : ''} (header baris {sheet.headerRow})</li>)}</ul>
        {!!ignoredSheets.length && <><strong>Sheet yang tidak diimpor — periksa sebelum melanjutkan</strong><ul>{ignoredSheets.map((sheet) => <li key={sheet.sheetName}>{sheet.sheetName}: {sheet.reason}</li>)}</ul></>}
      </div>}
      <div className="import-preview table-wrap"><table><thead><tr>{!!sheetNames.length && <th>Sheet</th>}<th>Baris</th><th>Nama</th><th>Nomor</th><th>Opt-in</th></tr></thead><tbody>{rows.slice(0, 5).map((row) => <tr key={`${row.sheetName ?? 'csv'}-${row.rowNumber}`}>
        {!!sheetNames.length && <td>{row.sheetName}</td>}<td>{row.rowNumber}</td><td>{row.fullName}</td><td>{row.phone}</td><td>{row.whatsappOptIn ? 'Ya' : 'Tidak'}</td>
      </tr>)}</tbody></table>{rows.length > 5 && <p className="preview-more">+ {rows.length - 5} baris lainnya</p>}</div>
      <div className="import-actions"><button type="button" onClick={reset}>Ganti file</button><button className="primary" type="button" disabled={importing} onClick={submitImport}>{importing ? 'Mengimpor...' : `Impor ${rows.length} kontak`}</button></div>
    </>}
    {result && <div className="import-result">
      <div><span><strong>{result.imported}</strong> berhasil</span><span><strong>{result.duplicates}</strong> duplikat</span><span><strong>{result.invalid}</strong> invalid</span><span><strong>{skipped + result.skipped}</strong> dilewati</span></div>
      {!!result.issues.length && <details><summary>Lihat detail baris</summary><ul>{result.issues.map((issue) => <li key={`${issue.sheetName ?? 'csv'}-${issue.rowNumber}-${issue.kind}`}>{issue.sheetName ? `Sheet ${issue.sheetName}, baris` : 'Baris'} {issue.rowNumber}: {issue.message}</li>)}</ul></details>}
      <button type="button" onClick={reset}>Impor file lain</button>
    </div>}
  </div>
}
