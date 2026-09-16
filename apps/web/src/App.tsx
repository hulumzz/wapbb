import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { ContactImportPanel } from './ContactImportPanel'

type Page = 'dashboard' | 'contacts' | 'campaigns' | 'templates' | 'history' | 'whatsapp'
type Contact = { id: string; fullName: string; phone: string; phoneNormalized: string; isActive: boolean; whatsappOptIn: boolean }
type Template = { id: string; name: string; content: string; isActive: boolean }
type Campaign = { id: string; name: string; status: string; batchSize: number; useBanner: boolean; createdAt: string; recipientCount: number; queuedCount: number; sentCount: number; failedCount: number }
type Message = { id: string; recipient: string; renderedMessage: string; status: string; attempts: number; maxAttempts: number; createdAt: string; errorCode?: string | null; errorMessage?: string | null }
type WhatsappState = { status: string; phoneNumber: string | null; qrDataUrl: string | null }
type Dashboard = { contacts: number; activeCampaigns: number; queued: number; sent: number; failed: number; whatsapp: WhatsappState }
type CampaignPreview = { recipientCount: number; useBanner: boolean; bannerUrl: string | null; samples: Array<{ contactId: string; fullName: string; recipient: string; renderedMessage: string }> }
type CampaignSettings = { defaultBannerUrl: string }

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

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

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
        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Tutup notifikasi" onClick={() => setNotice(null)}>×</button></div>}
        <section className="content">
          {page === 'dashboard' && <DashboardPage />}
          {page === 'contacts' && <ContactsPage notify={setNotice} />}
          {page === 'campaigns' && <CampaignsPage notify={setNotice} />}
          {page === 'templates' && <TemplatesPage notify={setNotice} />}
          {page === 'history' && <HistoryPage notify={setNotice} />}
          {page === 'whatsapp' && <WhatsappPage notify={setNotice} />}
        </section>
      </main>
    </div>
  )
}

function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  async function load(silent = false) {
    if (!silent) setRefreshing(true)
    try {
      setData(await api<Dashboard>('/api/dashboard'))
      setUpdatedAt(new Date())
      setError('')
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : 'Dashboard tidak dapat dimuat')
    } finally {
      setRefreshing(false)
    }
  }
  useEffect(() => {
    load()
    const timer = window.setInterval(() => load(true), 10000)
    return () => window.clearInterval(timer)
  }, [])
  if (error) return <EmptyState title="API belum tersambung" text={error} />
  if (!data) return <Loading />

  return <>
    <div className="status-banner">
      <div><span className={`status-led ${data.whatsapp.status === 'CONNECTED' ? 'online' : ''}`} /><strong>WhatsApp {data.whatsapp.status}</strong><p>{data.whatsapp.phoneNumber ?? 'Belum ada nomor yang terhubung'}</p></div>
      <div className="status-actions"><span className="muted">Diperbarui {updatedAt?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><button onClick={() => load()} disabled={refreshing}>{refreshing ? 'Memuat…' : '↻ Segarkan'}</button></div>
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [whatsappOptIn, setWhatsappOptIn] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  async function load() {
    setLoading(true)
    try {
      setItems(await api<Contact[]>(`/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`))
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Kontak tidak dapat dimuat')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [search])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy('save')
    try {
      await api(editingId ? `/api/contacts/${editingId}` : '/api/contacts', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({ fullName: name, phone, whatsappOptIn }),
      })
      const message = editingId ? 'Kontak berhasil diperbarui' : 'Kontak berhasil ditambahkan'
      setName(''); setPhone(''); setWhatsappOptIn(true); setEditingId(null); await load(); notify(message)
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menambah kontak') }
    finally { setBusy('') }
  }

  function edit(item: Contact) {
    setEditingId(item.id)
    setName(item.fullName)
    setPhone(item.phone)
    setWhatsappOptIn(item.whatsappOptIn)
  }

  async function deactivate(id: string) {
    if (!window.confirm('Nonaktifkan kontak ini? Kontak tidak akan dipilih untuk campaign baru.')) return
    setBusy(id)
    try {
      await api(`/api/contacts/${id}`, { method: 'DELETE' })
      await load()
      notify('Kontak dinonaktifkan')
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menonaktifkan kontak') }
    finally { setBusy('') }
  }

  async function activate(id: string) {
    setBusy(id)
    try {
      await api(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })
      await load()
      notify('Kontak diaktifkan kembali')
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal mengaktifkan kontak') }
    finally { setBusy('') }
  }

  return <>
    <div className="page-toolbar"><div><p className="eyebrow">PENERIMA PESAN</p><p>Kelola manual atau impor daftar kontak sekaligus.</p></div><button className={showImport ? 'active' : ''} onClick={() => setShowImport((value) => !value)}>{showImport ? 'Tutup impor' : '↑ Impor Excel / CSV'}</button></div>
    {showImport && <div className="panel import-shell"><ContactImportPanel onImported={load} notify={notify} /></div>}
    <div className="split-layout">
    <div className="panel grow">
      <div className="panel-head"><div><h2>Daftar kontak</h2><p>{items.length} kontak ditampilkan</p></div><input className="search" placeholder="Cari nama atau nomor…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="table-wrap"><table><thead><tr><th>Nama lengkap</th><th>Nomor WhatsApp</th><th>Normalized</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td><strong>{item.fullName}</strong></td><td>{item.phone}</td><td className="mono">{item.phoneNormalized}</td><td><span className={item.isActive && item.whatsappOptIn ? 'badge success' : 'badge'}>{!item.isActive ? 'Nonaktif' : item.whatsappOptIn ? 'Opt-in' : 'Opt-out'}</span></td><td><div className="row-actions"><button disabled={!!busy} onClick={() => edit(item)}>Edit</button>{item.isActive ? <button disabled={!!busy} onClick={() => deactivate(item.id)}>{busy === item.id ? 'Memproses…' : 'Nonaktifkan'}</button> : <button disabled={!!busy} onClick={() => activate(item.id)}>{busy === item.id ? 'Memproses…' : 'Aktifkan'}</button>}</div></td></tr>)}
        {!items.length && <tr><td colSpan={5}><div className="table-empty">{loading ? 'Memuat kontak…' : search ? 'Tidak ada kontak yang cocok.' : 'Belum ada kontak. Tambahkan manual atau impor file.'}</div></td></tr>}
      </tbody></table></div>
    </div>
    <form className="panel side-form" onSubmit={submit}><p className="eyebrow">{editingId ? 'EDIT KONTAK' : 'KONTAK BARU'}</p><h2>{editingId ? 'Perbarui penerima' : 'Tambah penerima'}</h2><label>Nama lengkap<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmad Fauzi" /></label><label>Nomor WhatsApp<input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812 3456 7890" /></label><label className="checkbox-row"><input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} /> Bersedia menerima WhatsApp</label><p className="hint">Nomor Indonesia otomatis dinormalisasi ke format 62…</p><button className="primary" disabled={!!busy}>{busy === 'save' ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah kontak'}</button>{editingId && <button type="button" disabled={!!busy} onClick={() => { setEditingId(null); setName(''); setPhone(''); setWhatsappOptIn(true) }}>Batal</button>}</form>
    </div>
  </>
}

function TemplatesPage({ notify }: { notify: (v: string) => void }) {
  const [items, setItems] = useState<Template[]>([])
  const [name, setName] = useState('Reminder PBB')
  const [content, setContent] = useState('Halo {{nama}},\n\nKami mengingatkan kembali mengenai pembayaran PBB. Jika pembayaran telah dilakukan, pesan ini dapat diabaikan.\n\nTerima kasih.')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const load = () => api<Template[]>('/api/templates').then(setItems)
  useEffect(() => { load().catch(() => undefined) }, [])
  function resetForm() {
    setEditingId(null)
    setName('Reminder PBB')
    setContent('Halo {{nama}},\n\nKami mengingatkan kembali mengenai pembayaran PBB. Jika pembayaran telah dilakukan, pesan ini dapat diabaikan.\n\nTerima kasih.')
  }
  function edit(template: Template) {
    setEditingId(template.id)
    setName(template.name)
    setContent(template.content)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api(editingId ? `/api/templates/${editingId}` : '/api/templates', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, content }),
      })
      await load()
      notify(editingId ? 'Template berhasil diperbarui' : 'Template berhasil disimpan')
      resetForm()
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menyimpan') }
    finally { setBusy(false) }
  }
  async function deactivate(id: string) { if (!window.confirm('Nonaktifkan template ini? Campaign yang sudah dibuat tidak berubah.')) return; setBusy(true); try { await api(`/api/templates/${id}`, { method: 'DELETE' }); await load(); notify('Template dinonaktifkan') } catch (e) { notify(e instanceof Error ? e.message : 'Gagal menonaktifkan template') } finally { setBusy(false) } }
  async function activate(id: string) { setBusy(true); try { await api(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); await load(); notify('Template diaktifkan kembali') } catch (e) { notify(e instanceof Error ? e.message : 'Gagal mengaktifkan template') } finally { setBusy(false) } }
  return <div className="split-layout">
    <div className="panel grow">
      <div className="panel-head"><div><h2>Template tersimpan</h2><p>Gunakan <code>{'{{nama}}'}</code> untuk personalisasi.</p></div></div>
      <div className="template-list">{items.map((template) => <article className="template-card" key={template.id}>
        <div><strong>{template.name}</strong><div className="row-actions"><span className={template.isActive ? 'badge success' : 'badge'}>{template.isActive ? 'Aktif' : 'Nonaktif'}</span><button disabled={busy} onClick={() => edit(template)}>Edit</button>{template.isActive ? <button disabled={busy} onClick={() => deactivate(template.id)}>Nonaktifkan</button> : <button disabled={busy} onClick={() => activate(template.id)}>Aktifkan</button>}</div></div>
        <pre>{template.content}</pre>
      </article>)}{!items.length && <div className="table-empty">Belum ada template.</div>}</div>
    </div>
    <form className="panel side-form wide" onSubmit={submit}>
      <p className="eyebrow">{editingId ? 'EDIT TEMPLATE' : 'TEMPLATE BARU'}</p><h2>{editingId ? 'Perbarui pesan' : 'Tulis pesan'}</h2>
      <label>Nama template<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Isi pesan<textarea required rows={11} value={content} onChange={(e) => setContent(e.target.value)} /></label>
      <div className="preview"><small>Preview</small><p>{content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi')}</p></div>
      <button className="primary" disabled={busy}>{busy ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan template'}</button>
      {editingId && <button type="button" disabled={busy} onClick={resetForm}>Batal edit</button>}
    </form>
  </div>
}

function CampaignsPage({ notify }: { notify: (v: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [name, setName] = useState('Reminder PBB')
  const [templateId, setTemplateId] = useState('')
  const [batchSize, setBatchSize] = useState(10)
  const [useBanner, setUseBanner] = useState(false)
  const [settings, setSettings] = useState<CampaignSettings | null>(null)
  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [busy, setBusy] = useState('')
  const load = async () => {
    const [c, t, availableContacts, campaignSettings] = await Promise.all([api<Campaign[]>('/api/campaigns'), api<Template[]>('/api/templates'), api<Contact[]>('/api/contacts'), api<CampaignSettings>('/api/campaigns/settings')])
    const eligible = availableContacts.filter((contact) => contact.isActive && contact.whatsappOptIn)
    setCampaigns(c); setTemplates(t); setContacts(eligible); setSettings(campaignSettings)
    setSelectedIds((current) => current.length ? current : eligible.map((contact) => contact.id))
    const firstActiveTemplate = t.find((template) => template.isActive)
    if (!templateId && firstActiveTemplate) setTemplateId(firstActiveTemplate.id)
  }
  useEffect(() => { load().catch(() => undefined) }, [])
  useEffect(() => {
    const timer = window.setInterval(() => api<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => undefined), 8000)
    return () => window.clearInterval(timer)
  }, [])
  const selectedTemplate = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])
  const payload = () => ({ name, templateId, batchSize, useBanner, contactIds: selectedIds })
  async function runPreview() {
    setBusy('preview')
    try { setPreview(await api<CampaignPreview>('/api/campaigns/preview', { method: 'POST', body: JSON.stringify(payload()) })) }
    catch (e) { setPreview(null); notify(e instanceof Error ? e.message : 'Gagal membuat preview') }
    finally { setBusy('') }
  }
  async function create(e: FormEvent) {
    e.preventDefault()
    if (!preview) return runPreview()
    if (busy) return
    setBusy('create')
    try {
      const result = await api<{ recipientCount: number }>('/api/campaigns', { method: 'POST', body: JSON.stringify(payload()) })
      setPreview(null); await load(); notify(`Campaign dibuat untuk ${result.recipientCount} kontak`)
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal membuat campaign') }
    finally { setBusy('') }
  }
  async function action(id: string, actionName: string) {
    if (actionName === 'start' && !window.confirm('Mulai campaign ini? Dispatcher dapat mengirim pesan pada jadwal berikutnya.')) return
    if (actionName === 'cancel' && !window.confirm('Batalkan campaign ini? Job yang masih mengantre tidak akan dikirim.')) return
    setBusy(`${id}-${actionName}`)
    try { await api(`/api/campaigns/${id}/${actionName}`, { method: 'POST' }); await load(); notify(`Status campaign berhasil diperbarui`) } catch (e) { notify(e instanceof Error ? e.message : 'Gagal') }
    finally { setBusy('') }
  }
  function toggleContact(id: string) {
    setPreview(null)
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }
  return <div className="split-layout">
    <div className="panel grow">
      <div className="panel-head"><div><h2>Campaign</h2><p>Campaign dibuat sebagai queue, bukan langsung blast.</p></div><span className="live-indicator"><i /> diperbarui otomatis</span></div>
      <div className="campaign-list">
        {campaigns.map((campaign) => {
          const progress = campaign.recipientCount ? Math.round((campaign.sentCount / campaign.recipientCount) * 100) : 0
          return <article className="campaign-card" key={campaign.id}>
            <div className="campaign-row">
              <div><strong>{campaign.name}</strong><p>{new Date(campaign.createdAt).toLocaleString('id-ID')} · batch {campaign.batchSize} · {campaign.useBanner ? 'banner' : 'text-only'}</p></div>
              <div className="row-actions">
                <span className={`badge ${['RUNNING', 'COMPLETED'].includes(campaign.status) ? 'success' : campaign.status === 'CANCELLED' ? 'danger' : ''}`}>{campaign.status}</span>
                {campaign.status === 'DRAFT' && <button disabled={!!busy} onClick={() => action(campaign.id, 'start')}>Mulai</button>}
                {campaign.status === 'RUNNING' && <button disabled={!!busy} onClick={() => action(campaign.id, 'pause')}>Pause</button>}
                {campaign.status === 'PAUSED' && <button disabled={!!busy} onClick={() => action(campaign.id, 'resume')}>Resume</button>}
                {['DRAFT', 'RUNNING', 'PAUSED'].includes(campaign.status) && <button disabled={!!busy} onClick={() => action(campaign.id, 'cancel')}>Batalkan</button>}
              </div>
            </div>
            <div className="campaign-progress"><div><span style={{ width: `${progress}%` }} /></div><p><strong>{campaign.sentCount}/{campaign.recipientCount}</strong> terkirim <span>{campaign.queuedCount} antre · {campaign.failedCount} gagal</span></p></div>
          </article>
        })}
        {!campaigns.length && <div className="table-empty">Belum ada campaign.</div>}
      </div>
    </div>
    <form className="panel side-form wide" onSubmit={create}>
      <p className="eyebrow">CAMPAIGN BARU</p><h2>Siapkan antrean</h2>
      <label>Nama campaign<input value={name} onChange={(event) => { setName(event.target.value); setPreview(null) }} /></label>
      <label>Template<select required value={templateId} onChange={(event) => { setTemplateId(event.target.value); setPreview(null) }}><option value="">Pilih template</option>{templates.filter((template) => template.isActive).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <label>Ukuran batch<input type="number" min={1} max={50} value={batchSize} onChange={(event) => { setBatchSize(Number(event.target.value)); setPreview(null) }} /></label>
      <label className="checkbox-row banner-option"><input type="checkbox" checked={useBanner} onChange={(event) => { setUseBanner(event.target.checked); setPreview(null) }} /><span>Gunakan banner PBB<small>Gambar dikirim sebagai media dengan template sebagai caption.</small></span></label>
      {useBanner && settings?.defaultBannerUrl && <div className="banner-preview"><img src={settings.defaultBannerUrl} alt="Preview banner PBB" /><span>Banner default campaign</span></div>}
      <fieldset className="recipient-picker">
        <legend>Penerima ({selectedIds.length}/{contacts.length})</legend>
        <div className="recipient-tools"><button type="button" onClick={() => { setSelectedIds(contacts.map((contact) => contact.id)); setPreview(null) }}>Pilih semua</button><button type="button" onClick={() => { setSelectedIds([]); setPreview(null) }}>Kosongkan</button></div>
        <div>{contacts.map((contact) => <label className="checkbox-row" key={contact.id}><input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} /><span>{contact.fullName}<small>{contact.phoneNormalized}</small></span></label>)}</div>
      </fieldset>
      {preview
        ? <div className="preview">{preview.useBanner && preview.bannerUrl && <img className="message-banner-preview" src={preview.bannerUrl} alt="Banner yang akan dikirim" />}<small>Preview final · {preview.recipientCount} penerima</small>{preview.samples.map((sample) => <p key={sample.contactId}><strong>{sample.fullName}</strong><br />{sample.renderedMessage}</p>)}</div>
        : <div className="preview">{useBanner && settings?.defaultBannerUrl && <img className="message-banner-preview" src={settings.defaultBannerUrl} alt="Banner yang akan dikirim" />}<small>Preview template</small><p>{selectedTemplate?.content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi') ?? 'Pilih template terlebih dahulu.'}</p></div>}
      <button type="button" onClick={runPreview} disabled={!!busy || !templateId || !selectedIds.length}>{busy === 'preview' ? 'Menyiapkan preview…' : 'Tinjau campaign'}</button>
      <button className="primary" disabled={!!busy || !preview}>{busy === 'create' ? 'Membuat antrean…' : preview ? 'Konfirmasi & buat draft' : 'Tinjau dahulu'}</button>
    </form>
  </div>
}

function HistoryPage({ notify }: { notify: (v: string) => void }) {
  const [items, setItems] = useState<Message[]>([])
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try { setItems(await api<Message[]>('/api/messages')) }
    catch (caught) { if (!silent) notify(caught instanceof Error ? caught.message : 'Riwayat tidak dapat dimuat') }
    finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    load()
    const timer = window.setInterval(() => load(true), 7000)
    return () => window.clearInterval(timer)
  }, [])
  const filtered = useMemo(() => items.filter((item) => {
    const statusMatches = status === 'ALL' || item.status === status
    const needle = search.trim().toLowerCase()
    return statusMatches && (!needle || item.recipient.includes(needle) || item.renderedMessage.toLowerCase().includes(needle))
  }), [items, search, status])
  const counts = useMemo(() => ({ sent: items.filter((item) => item.status === 'SENT').length, queued: items.filter((item) => ['QUEUED', 'PROCESSING'].includes(item.status)).length, failed: items.filter((item) => item.status === 'FAILED').length }), [items])
  async function retry(id: string) {
    if (!window.confirm('Antrekan ulang pesan ini? Pesan dapat terkirim saat dispatcher berikutnya berjalan.')) return
    try {
      await api(`/api/messages/${id}/retry`, { method: 'POST' })
      await load()
      notify('Message job kembali masuk antrean')
    } catch (e) { notify(e instanceof Error ? e.message : 'Gagal retry message job') }
  }
  return <div className="panel"><div className="panel-head"><div><h2>Riwayat pesan</h2><p>200 job terbaru · daftar diperbarui otomatis setiap 7 detik.</p></div><button onClick={() => load()} disabled={loading}>{loading ? 'Memuat…' : '↻ Muat ulang'}</button></div><div className="history-summary"><span><i className="sent" />{counts.sent} terkirim</span><span><i className="queued" />{counts.queued} diproses</span><span><i className="failed" />{counts.failed} gagal</span></div><div className="filter-bar"><input className="search" placeholder="Cari nomor atau isi pesan…" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Semua status</option><option value="QUEUED">Queued</option><option value="PROCESSING">Processing</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select><span>{filtered.length} hasil</span></div><div className="table-wrap"><table><thead><tr><th>Penerima</th><th>Pesan</th><th>Status</th><th>Percobaan</th><th>Waktu</th><th>Aksi</th></tr></thead><tbody>{filtered.map((m) => <tr key={m.id}><td className="mono">{m.recipient}</td><td className="message-cell">{m.renderedMessage}{m.errorMessage && <small className="job-error">{m.errorCode}: {m.errorMessage}</small>}</td><td><span className={`badge ${m.status === 'SENT' ? 'success' : m.status === 'FAILED' ? 'danger' : ''}`}>{m.status}</span></td><td>{m.attempts}/{m.maxAttempts}</td><td>{new Date(m.createdAt).toLocaleString('id-ID')}</td><td>{m.status === 'FAILED' && <button onClick={() => retry(m.id)}>Retry</button>}</td></tr>)}{!filtered.length && <tr><td colSpan={6}><div className="table-empty">{loading ? 'Memuat riwayat…' : items.length ? 'Tidak ada job yang cocok dengan filter.' : 'Belum ada message job.'}</div></td></tr>}</tbody></table></div><p className="safety-note">Retry status FAILED dilakukan manual agar pengiriman dengan hasil tidak pasti tidak terduplikasi.</p></div>
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
