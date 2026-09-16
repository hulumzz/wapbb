import { ChangeEvent, useState } from 'react'
import { api } from './api'
import { ContactImportRow, parseContactFile } from './contact-import'

type ImportIssue = { rowNumber: number; kind: 'INVALID' | 'DUPLICATE'; message: string }
type ImportResult = { received: number; imported: number; duplicates: number; invalid: number; issues: ImportIssue[] }

export function ContactImportPanel({ onImported, notify }: { onImported: () => Promise<void>; notify: (message: string) => void }) {
  const [rows, setRows] = useState<ContactImportRow[]>([])
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
    setFileName(file.name)
    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran file maksimal 5 MB.')
      setInputKey((value) => value + 1)
      return
    }

    setReading(true)
    try {
      setRows(await parseContactFile(file))
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
    setFileName('')
    setError('')
    setResult(null)
    setInputKey((value) => value + 1)
  }

  return <div className="import-panel">
    <div className="import-intro">
      <div><p className="eyebrow">IMPOR MASSAL</p><h3>Tambahkan dari Excel atau CSV</h3><p>Kolom wajib: <strong>Nama Lengkap</strong> dan <strong>Nomor WhatsApp</strong>. Tanpa nilai <strong>Opt In</strong> yang eksplisit, kontak disimpan sebagai opt-out.</p></div>
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
      <div className="import-summary"><strong>{rows.length}</strong><span>baris siap diperiksa server</span></div>
      <div className="import-preview table-wrap"><table><thead><tr><th>Baris</th><th>Nama</th><th>Nomor</th><th>Opt-in</th></tr></thead><tbody>{rows.slice(0, 5).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.fullName || '-'}</td><td>{row.phone || '-'}</td><td>{row.whatsappOptIn ? 'Ya' : 'Tidak'}</td></tr>)}</tbody></table>{rows.length > 5 && <p className="preview-more">+ {rows.length - 5} baris lainnya</p>}</div>
      <div className="import-actions"><button type="button" onClick={reset}>Ganti file</button><button className="primary" type="button" disabled={importing} onClick={submitImport}>{importing ? 'Mengimpor...' : `Impor ${rows.length} kontak`}</button></div>
    </>}
    {result && <div className="import-result">
      <div><span><strong>{result.imported}</strong> berhasil</span><span><strong>{result.duplicates}</strong> duplikat</span><span><strong>{result.invalid}</strong> invalid</span></div>
      {!!result.issues.length && <details><summary>Lihat detail baris</summary><ul>{result.issues.map((issue) => <li key={`${issue.rowNumber}-${issue.kind}`}>Baris {issue.rowNumber}: {issue.message}</li>)}</ul></details>}
      <button type="button" onClick={reset}>Impor file lain</button>
    </div>}
  </div>
}
