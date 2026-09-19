import { ChangeEvent, useState } from 'react'
import { api } from './api'
import { ContactImportRow, parseContactFile } from './contact-import'

type ImportIssue = { sheetName?: string; rowNumber: number; kind: 'INVALID' | 'DUPLICATE'; message: string }
type ImportResult = { received: number; imported: number; duplicates: number; invalid: number; skipped: number; issues: ImportIssue[] }

export function ContactImportPanel({ onImported, notify }: { onImported: () => Promise<void>; notify: (message: string) => void }) {
  const [rows, setRows] = useState<ContactImportRow[]>([])
  const [skipped, setSkipped] = useState(0)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [inputKey, setInputKey] = useState(0)

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setResult(null)
    setRows([])
    setSkipped(0)
    setSheetNames([])
    setFileName(file.name)
    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran file maksimal 5 MB.')
      setInputKey((value) => value + 1)
      return
    }

    setReading(true)
    try {
      const parsed = await parseContactFile(file)
      setRows(parsed.rows)
      setSkipped(parsed.skipped)
      setSheetNames(parsed.sheetNames)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'File tidak dapat dibaca.')
      setInputKey((value) => value + 1)
    } finally {
      setReading(false)
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
    setRows([])
    setSkipped(0)
    setSheetNames([])
    setFileName('')
    setError('')
    setResult(null)
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
