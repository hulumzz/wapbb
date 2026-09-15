import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './api'

type Page = 'dashboard' | 'contacts' | 'campaigns' | 'templates' | 'history' | 'whatsapp'
type Contact = { id: string; fullName: string; phone: string; phoneNormalized: string; isActive: boolean }
type Template = { id: string; name: string; content: string; isActive: boolean }
type Campaign = { id: string; name: string; status: string; batchSize: number; createdAt: string }
type Message = { id: string; recipient: string; renderedMessage: string; status: string; createdAt: string; errorMessage?: string | null }
type WhatsappState = { status: string; phoneNumber: string | null; qrDataUrl: string | null }
type Dashboard = { contacts: number; activeCampaigns: number; queued: number; sent: number; failed: number; whatsapp: WhatsappState }

const nav: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'contacts', label: 'Kontak', icon: '◎' },
  { id: 'campaigns', label: 'Campaign', icon: '↗' },
  { id: 'templates', label: 'Template Pesan', icon: '▤' },
  { id: 'history', label: 'Riwayat', icon: '◷' },
  { id: 'whatsapp', label: 'WhatsApp', icon: '●' },
]

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <div><strong>WA Reminder</strong><small>Messaging Console</small></div>
        </div>
        <nav>
          {nav.map((item) => (
            <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><span className="dot" /> V1 Pilot · 100 kontak</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">WA PBB REMINDER</p><h1>{nav.find((n) => n.id === page)?.label}</h1></div>
          <div className="admin-pill"><span>AD</span><div><strong>Administrator</strong><small>Desa</small></div></div>
        </header>
        {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
        <section className="content">
          {page === 'dashboard' && <DashboardPage />}
          {page === 'contacts' && <ContactsPage notify={setNotice} />}
          {page === 'campaigns' && <CampaignsPage notify={setNotice} />}
          {page === 'templates' && <TemplatesPage notify={setNotice} />}
          {page === 'history' && <HistoryPage />}
          {page === 'whatsapp' && <WhatsappPage notify={setNotice} />}
        </section>
      </main>
    </div>
  )
}

function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Dashboard>('/api/dashboard').then(setData).catch((e) => setError(e.message)) }, [])
  if (error) return <EmptyState title="API belum tersambung" text={error} />
  if (!data) return <Loading />

  return <>
    <div className="status-banner">
      <div><span className={`status-led ${data.whatsapp.status === 'CONNECTED' ? 'online' : ''}`} /><strong>WhatsApp {data.whatsapp.status}</strong><p>{data.whatsapp.phoneNumber ?? 'Belum ada nomor yang terhubung'}</p></div>
      <span className="muted">Queue tersimpan di PostgreSQL</span>
    </div>
    <div className="metric-grid">
      <Metric label="Kontak aktif" value={data.contacts} helper="Siap dipilih" />
      <Metric label="Campaign aktif" value={data.activeCampaigns} helper="Sedang berjalan" />
      <Metric label="Dalam antrean" value={data.queued} helper="Menunggu batch" />
      <Metric label="Terkirim" value={data.sent} helper="Berhasil diproses" />
      <Metric label="Gagal" value={data.failed} helper="Perlu diperiksa" />
    </div>
    <div className="panel hero-panel"><div><p className="eyebrow">FLOW V1</p><h2>Kontak → Template → Campaign → Queue → WhatsApp</h2><p className="muted">Data awal hanya nama lengkap dan nomor WhatsApp. Detail PBB akan ditambahkan setelah messaging engine stabil.</p></div><div className="flow-pills"><span>10 / batch</span><span>DB-backed</span><span>No Chromium</span></div></div>
  </>
}

function ContactsPage({ notify }: { notify: (v: string) => void }) {
  const [items, setItems] = useState<Contact[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [search, setSearch] = useState('')
  const load = () => api<Contact[]>(`/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setItems)
  useEffect(() => { load().catch(() => undefined) }, [search])

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await api('/api/contacts', { method: 'POST', body: JSON.stringify({ fullName: name, phone, whatsappOptIn: true }) })
      setName(''); setPhone(''); await load(); notify('Kontak berhasil ditambahkan')
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menambah kontak') }
  }

  return <div className="split-layout">
    <div className="panel grow">
      <div className="panel-head"><div><h2>Daftar kontak</h2><p>{items.length} kontak ditampilkan</p></div><input className="search" placeholder="Cari nama atau nomor…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="table-wrap"><table><thead><tr><th>Nama lengkap</th><th>Nomor WhatsApp</th><th>Normalized</th><th>Status</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.fullName}</strong></td><td>{item.phone}</td><td className="mono">{item.phoneNormalized}</td><td><span className={item.isActive ? 'badge success' : 'badge'}>{item.isActive ? 'Aktif' : 'Nonaktif'}</span></td></tr>)}
        {!items.length && <tr><td colSpan={4}><div className="table-empty">Belum ada kontak. Tambahkan kontak pertama dari form di samping.</div></td></tr>}
      </tbody></table></div>
    </div>
    <form className="panel side-form" onSubmit={submit}><p className="eyebrow">KONTAK BARU</p><h2>Tambah penerima</h2><label>Nama lengkap<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmad Fauzi" /></label><label>Nomor WhatsApp<input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812 3456 7890" /></label><p className="hint">Nomor Indonesia otomatis dinormalisasi ke format 62…</p><button className="primary">Tambah kontak</button></form>
  </div>
}

function TemplatesPage({ notify }: { notify: (v: string) => void }) {
  const [items, setItems] = useState<Template[]>([])
  const [name, setName] = useState('Reminder PBB')
  const [content, setContent] = useState('Halo {{nama}},\n\nKami mengingatkan kembali mengenai pembayaran PBB. Jika pembayaran telah dilakukan, pesan ini dapat diabaikan.\n\nTerima kasih.')
  const load = () => api<Template[]>('/api/templates').then(setItems)
  useEffect(() => { load().catch(() => undefined) }, [])
  async function submit(e: FormEvent) { e.preventDefault(); try { await api('/api/templates', { method: 'POST', body: JSON.stringify({ name, content }) }); await load(); notify('Template berhasil disimpan') } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menyimpan') } }
  return <div className="split-layout"><div className="panel grow"><div className="panel-head"><div><h2>Template tersimpan</h2><p>Gunakan <code>{'{{nama}}'}</code> untuk personalisasi.</p></div></div><div className="template-list">{items.map((t) => <article className="template-card" key={t.id}><div><strong>{t.name}</strong><span className="badge success">Aktif</span></div><pre>{t.content}</pre></article>)}{!items.length && <div className="table-empty">Belum ada template.</div>}</div></div><form className="panel side-form wide" onSubmit={submit}><p className="eyebrow">TEMPLATE BARU</p><h2>Tulis pesan</h2><label>Nama template<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Isi pesan<textarea rows={11} value={content} onChange={(e) => setContent(e.target.value)} /></label><div className="preview"><small>Preview</small><p>{content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi')}</p></div><button className="primary">Simpan template</button></form></div>
}

function CampaignsPage({ notify }: { notify: (v: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [name, setName] = useState('Reminder PBB')
  const [templateId, setTemplateId] = useState('')
  const [batchSize, setBatchSize] = useState(10)
  const load = async () => { const [c, t] = await Promise.all([api<Campaign[]>('/api/campaigns'), api<Template[]>('/api/templates')]); setCampaigns(c); setTemplates(t); if (!templateId && t[0]) setTemplateId(t[0].id) }
  useEffect(() => { load().catch(() => undefined) }, [])
  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])
  async function create(e: FormEvent) { e.preventDefault(); try { const result = await api<{ recipientCount: number }>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name, templateId, batchSize }) }); await load(); notify(`Campaign dibuat untuk ${result.recipientCount} kontak`) } catch (e) { notify(e instanceof Error ? e.message : 'Gagal membuat campaign') } }
  async function action(id: string, actionName: string) { try { await api(`/api/campaigns/${id}/${actionName}`, { method: 'POST' }); await load(); notify(`Campaign: ${actionName}`) } catch (e) { notify(e instanceof Error ? e.message : 'Gagal') } }
  return <div className="split-layout"><div className="panel grow"><div className="panel-head"><div><h2>Campaign</h2><p>Campaign dibuat sebagai queue, bukan langsung blast.</p></div></div><div className="campaign-list">{campaigns.map((c) => <article className="campaign-row" key={c.id}><div><strong>{c.name}</strong><p>{new Date(c.createdAt).toLocaleString('id-ID')} · batch {c.batchSize}</p></div><div className="row-actions"><span className={`badge ${c.status === 'RUNNING' ? 'success' : ''}`}>{c.status}</span>{c.status === 'DRAFT' && <button onClick={() => action(c.id, 'start')}>Mulai</button>}{c.status === 'RUNNING' && <button onClick={() => action(c.id, 'pause')}>Pause</button>}{c.status === 'PAUSED' && <button onClick={() => action(c.id, 'resume')}>Resume</button>}</div></article>)}{!campaigns.length && <div className="table-empty">Belum ada campaign.</div>}</div></div><form className="panel side-form wide" onSubmit={create}><p className="eyebrow">CAMPAIGN BARU</p><h2>Siapkan antrean</h2><label>Nama campaign<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Template<select required value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Pilih template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Ukuran batch<input type="number" min={1} max={50} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} /></label><div className="preview"><small>Preview template</small><p>{selectedTemplate?.content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi') ?? 'Pilih template terlebih dahulu.'}</p></div><p className="hint">V1 menggunakan semua kontak aktif yang opt-in. Pemilihan kontak individual menyusul.</p><button className="primary" disabled={!templateId}>Buat campaign draft</button></form></div>
}

function HistoryPage() {
  const [items, setItems] = useState<Message[]>([])
  useEffect(() => { api<Message[]>('/api/messages').then(setItems).catch(() => undefined) }, [])
  return <div className="panel"><div className="panel-head"><div><h2>Riwayat pesan</h2><p>200 job terbaru.</p></div></div><div className="table-wrap"><table><thead><tr><th>Penerima</th><th>Pesan</th><th>Status</th><th>Waktu</th></tr></thead><tbody>{items.map((m) => <tr key={m.id}><td className="mono">{m.recipient}</td><td className="message-cell">{m.renderedMessage}</td><td><span className={`badge ${m.status === 'SENT' ? 'success' : m.status === 'FAILED' ? 'danger' : ''}`}>{m.status}</span></td><td>{new Date(m.createdAt).toLocaleString('id-ID')}</td></tr>)}{!items.length && <tr><td colSpan={4}><div className="table-empty">Belum ada message job.</div></td></tr>}</tbody></table></div></div>
}

function WhatsappPage({ notify }: { notify: (v: string) => void }) {
  const [state, setState] = useState<WhatsappState | null>(null)
  const load = () => api<WhatsappState>('/api/whatsapp/status').then(setState)
  useEffect(() => { load().catch(() => undefined); const timer = setInterval(() => load().catch(() => undefined), 3000); return () => clearInterval(timer) }, [])
  async function connect() { try { setState(await api('/api/whatsapp/connect', { method: 'POST' })); notify('Proses koneksi WhatsApp dimulai') } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menghubungkan') } }
  async function disconnect() { try { setState(await api('/api/whatsapp/disconnect', { method: 'POST' })); notify('Koneksi WhatsApp dihentikan tanpa menghapus session') } catch (e) { notify(e instanceof Error ? e.message : 'Gagal disconnect') } }
  return <div className="whatsapp-grid"><div className="panel connection-card"><p className="eyebrow">CONNECTION</p><div className="wa-icon">WA</div><h2>{state?.status ?? 'Memuat…'}</h2><p className="muted">{state?.phoneNumber ?? 'Belum ada nomor terhubung'}</p><div className="connection-actions">{state?.status !== 'CONNECTED' ? <button className="primary" onClick={connect}>Hubungkan WhatsApp</button> : <button onClick={disconnect}>Disconnect</button>}</div></div><div className="panel qr-card"><p className="eyebrow">PAIRING</p><h2>Scan QR dari WhatsApp</h2><p className="muted">Session disimpan terenkripsi di PostgreSQL sehingga restart server tidak bergantung pada storage lokal.</p>{state?.qrDataUrl ? <img className="qr" src={state.qrDataUrl} alt="WhatsApp QR" /> : <div className="qr-placeholder"><span>{state?.status === 'CONNECTED' ? '✓' : 'QR'}</span><p>{state?.status === 'CONNECTED' ? 'Perangkat sudah terhubung' : 'Klik Hubungkan WhatsApp untuk membuat QR'}</p></div>}</div></div>
}

function Metric({ label, value, helper }: { label: string; value: number; helper: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{helper}</small></div> }
function Loading() { return <div className="loading">Memuat data…</div> }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="panel empty"><h2>{title}</h2><p>{text}</p><small>Pastikan API dan PostgreSQL sudah berjalan.</small></div> }
