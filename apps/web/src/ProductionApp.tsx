import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getAuthUser } from './api'
import { ContactImportPanel } from './ContactImportPanel'

type Page = 'dashboard' | 'contacts' | 'campaigns' | 'templates' | 'history' | 'whatsapp'
type Contact = { id: string; fullName: string; phone: string; phoneNormalized: string; isActive: boolean; whatsappOptIn: boolean }
type Template = { id: string; name: string; content: string; isActive: boolean }
type Campaign = {
  id: string
  name: string
  status: string
  batchSize: number
  useBanner: boolean
  useInteractiveCta: boolean
  createdAt: string
  recipientCount: number
  queuedCount: number
  sentCount: number
  deliveredCount: number
  readCount: number
  failedCount: number
}
type Message = {
  id: string
  recipient: string
  renderedMessage: string
  status: string
  deliveryStatus?: string | null
  attempts: number
  maxAttempts: number
  createdAt: string
  sentAt?: string | null
  deliveredAt?: string | null
  readAt?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}
type WhatsappState = { status: string; phoneNumber: string | null; qrDataUrl: string | null }
type Dashboard = {
  contacts: number
  activeCampaigns: number
  queued: number
  sent: number
  delivered: number
  read: number
  failed: number
  whatsapp: WhatsappState
}
type CampaignPreview = {
  previewToken: string
  recipientCount: number
  useBanner: boolean
  useInteractiveCta: boolean
  bannerUrl: string | null
  ctaLabel: string | null
  ctaFooter: string | null
  samples: Array<{ contactId: string; fullName: string; recipient: string; renderedMessage: string; ctaUrl?: string }>
}
type CampaignSettings = {
  defaultBannerUrl: string
  interactiveCtaEnabled: boolean
  interactiveCtaLabel: string
  interactiveCtaFooter: string
}
type Notify = (message: string) => void

const nav: Array<{ id: Page; label: string; description: string; icon: IconName }> = [
  { id: 'dashboard', label: 'Ringkasan', description: 'Kondisi layanan dan aktivitas pengiriman', icon: 'grid' },
  { id: 'contacts', label: 'Kontak', description: 'Penerima yang sudah memberikan persetujuan', icon: 'users' },
  { id: 'campaigns', label: 'Campaign', description: 'Siapkan dan pantau antrean pesan', icon: 'send' },
  { id: 'templates', label: 'Template', description: 'Kelola isi pesan yang digunakan berulang', icon: 'file' },
  { id: 'history', label: 'Riwayat', description: 'Status proses dan pengantaran pesan', icon: 'history' },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Koneksi perangkat dan sesi pengiriman', icon: 'message' },
]

const campaignStatus: Record<string, string> = {
  DRAFT: 'Draft', RUNNING: 'Berjalan', PAUSED: 'Dijeda', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan',
}
const jobStatus: Record<string, string> = {
  QUEUED: 'Dalam antrean', PROCESSING: 'Diproses', SENT: 'Diserahkan', FAILED: 'Gagal', SKIPPED: 'Dilewati', CANCELLED: 'Dibatalkan',
}
const deliveryStatus: Record<string, string> = {
  PENDING: 'Menunggu konfirmasi', SERVER_ACK: 'Diterima server', DELIVERED: 'Terkirim ke perangkat', READ: 'Dibaca', PLAYED: 'Dibuka', ERROR: 'Ditolak', UNKNOWN: 'Belum dapat dipastikan',
}
const whatsappStatus: Record<string, string> = {
  DISCONNECTED: 'Tidak terhubung', CONNECTING: 'Menghubungkan', QR_READY: 'Menunggu pemindaian QR', CONNECTED: 'Terhubung', NEEDS_REAUTH: 'Perlu dihubungkan ulang',
}

export default function ProductionApp() {
  const [page, setPage] = useState<Page>('dashboard')
  const [notice, setNotice] = useState<string | null>(null)
  const current = nav.find((item) => item.id === page) ?? nav[0]

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>WAPBB</strong><small>Pesan layanan desa</small></div></div>
        <nav aria-label="Navigasi utama">
          {nav.map((item) => (
            <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>
              <Icon name={item.icon} /> <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><span className="dot" /> Layanan pesan aktif</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{current.label}</h1><p>{current.description}</p></div>
          <div className="topbar-actions"><span className="operator"><i>{getAuthUser().slice(0, 2).toUpperCase()}</i><span><strong>{getAuthUser()}</strong><small>Administrator</small></span></span><button className="quiet-button" onClick={() => window.dispatchEvent(new Event('wapbb:logout'))}>Keluar</button></div>
        </header>
        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Tutup notifikasi" onClick={() => setNotice(null)}>x</button></div>}
        <section className="content">
          {page === 'dashboard' && <DashboardPage navigate={setPage} />}
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

function DashboardPage({ navigate }: { navigate: (page: Page) => void }) {
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
      if (!silent) setError(caught instanceof Error ? caught.message : 'Ringkasan tidak dapat dimuat')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 10000)
    return () => window.clearInterval(timer)
  }, [])

  if (error) return <EmptyState title="Layanan belum dapat dijangkau" text={error} action={<button onClick={() => load()}>Coba lagi</button>} />
  if (!data) return <Loading />

  const connected = data.whatsapp.status === 'CONNECTED'
  return <>
    <div className={`connection-strip ${connected ? 'connected' : ''}`}>
      <div><span className="status-led" /><div><strong>WhatsApp {whatsappStatus[data.whatsapp.status] ?? data.whatsapp.status}</strong><p>{data.whatsapp.phoneNumber ? `+${data.whatsapp.phoneNumber}` : 'Hubungkan perangkat sebelum menjalankan campaign'}</p></div></div>
      <div className="status-actions"><span>Diperbarui {formatTime(updatedAt)}</span><button onClick={() => load()} disabled={refreshing}><Icon name="refresh" /> {refreshing ? 'Memuat' : 'Segarkan'}</button></div>
    </div>

    <div className="metric-grid">
      <Metric label="Kontak aktif" value={data.contacts} helper="siap dipilih" icon="users" />
      <Metric label="Campaign berjalan" value={data.activeCampaigns} helper="sedang diproses" icon="send" />
      <Metric label="Dalam antrean" value={data.queued} helper="menunggu dispatcher" icon="history" />
      <Metric label="Diserahkan" value={data.sent} helper="ke server WhatsApp" icon="upload" />
      <Metric label="Terkirim" value={data.delivered} helper={`${data.read} sudah dibaca`} icon="check" />
      <Metric label="Perlu perhatian" value={data.failed} helper="gagal atau tidak pasti" icon="alert" tone={data.failed ? 'danger' : undefined} />
    </div>

    <div className="dashboard-grid">
      <section className="panel quick-panel"><div><p className="section-kicker">AKSI CEPAT</p><h2>Mulai pekerjaan berikutnya</h2><p>Siapkan kontak dan tinjau isi pesan sebelum campaign masuk antrean.</p></div><div><button className="primary" onClick={() => navigate('campaigns')}><Icon name="send" /> Buat campaign</button><button onClick={() => navigate('contacts')}><Icon name="users" /> Kelola kontak</button></div></section>
      <section className="panel system-panel"><div className="panel-head"><div><h2>Kesiapan sistem</h2><p>Komponen utama pengiriman</p></div><span className="badge success">Operasional</span></div><SystemRow label="Antrean persisten" text="Tersimpan di PostgreSQL" /><SystemRow label="Session WhatsApp" text={connected ? 'Aktif dan siap mengirim' : 'Belum siap mengirim'} ok={connected} /><SystemRow label="Konfirmasi pengantaran" text="Status server, terkirim, dan dibaca" /></section>
    </div>
  </>
}

function ContactsPage({ notify }: { notify: Notify }) {
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
    try { setItems(await api<Contact[]>(`/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`)) }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Kontak tidak dapat dimuat') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [search])

  function resetForm() { setEditingId(null); setName(''); setPhone(''); setWhatsappOptIn(true) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('save')
    try {
      await api(editingId ? `/api/contacts/${editingId}` : '/api/contacts', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ fullName: name, phone, whatsappOptIn }) })
      notify(editingId ? 'Kontak berhasil diperbarui' : 'Kontak berhasil ditambahkan')
      resetForm(); await load()
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Kontak gagal disimpan') }
    finally { setBusy('') }
  }
  function edit(item: Contact) { setEditingId(item.id); setName(item.fullName); setPhone(item.phone); setWhatsappOptIn(item.whatsappOptIn) }
  async function setActive(item: Contact, active: boolean) {
    if (!active && !window.confirm(`Nonaktifkan ${item.fullName}? Kontak tidak akan dipilih untuk campaign baru.`)) return
    setBusy(item.id)
    try {
      await api(`/api/contacts/${item.id}`, active ? { method: 'PATCH', body: JSON.stringify({ isActive: true }) } : { method: 'DELETE' })
      await load(); notify(active ? 'Kontak diaktifkan kembali' : 'Kontak dinonaktifkan')
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Status kontak gagal diperbarui') }
    finally { setBusy('') }
  }

  return <>
    <div className="page-toolbar"><div><strong>{items.length} kontak ditemukan</strong><span>Hanya kontak aktif dan opt-in yang dapat menerima campaign.</span></div><button className={showImport ? 'active' : ''} onClick={() => setShowImport((value) => !value)}><Icon name="upload" /> {showImport ? 'Tutup import' : 'Import Excel / CSV'}</button></div>
    {showImport && <div className="panel import-shell"><ContactImportPanel onImported={load} notify={notify} /></div>}
    <div className="split-layout">
      <section className="panel grow"><div className="panel-head"><div><h2>Daftar kontak</h2><p>Nama, nomor, dan persetujuan penerima</p></div><div className="search-box"><Icon name="search" /><input placeholder="Cari nama atau nomor" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
        <div className="table-wrap"><table><thead><tr><th>Kontak</th><th>Nomor WhatsApp</th><th>Status</th><th className="action-column">Aksi</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td><strong>{item.fullName}</strong></td><td><span className="mono">+{item.phoneNormalized}</span><small className="cell-note">Input: {item.phone}</small></td><td><StatusBadge value={!item.isActive ? 'Nonaktif' : item.whatsappOptIn ? 'Siap menerima' : 'Belum opt-in'} tone={item.isActive && item.whatsappOptIn ? 'success' : 'neutral'} /></td><td><div className="row-actions"><button disabled={!!busy} onClick={() => edit(item)}>Edit</button><button disabled={!!busy} onClick={() => setActive(item, !item.isActive)}>{busy === item.id ? 'Memproses' : item.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></td></tr>)}
          {!items.length && <tr><td colSpan={4}><div className="table-empty">{loading ? 'Memuat kontak...' : search ? 'Tidak ada kontak yang cocok.' : 'Belum ada kontak. Tambahkan manual atau import file.'}</div></td></tr>}
        </tbody></table></div>
      </section>
      <form className="panel side-form" onSubmit={submit}><div className="form-title"><span className="form-icon"><Icon name={editingId ? 'edit' : 'users'} /></span><div><p className="section-kicker">{editingId ? 'EDIT KONTAK' : 'KONTAK BARU'}</p><h2>{editingId ? 'Perbarui penerima' : 'Tambah penerima'}</h2></div></div><label>Nama lengkap<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama penerima" /></label><label>Nomor WhatsApp<input required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812 3456 7890" /></label><label className="toggle-row"><input type="checkbox" checked={whatsappOptIn} onChange={(event) => setWhatsappOptIn(event.target.checked)} /><span><strong>Persetujuan WhatsApp</strong><small>Penerima bersedia menerima informasi.</small></span></label><p className="hint">Nomor Indonesia dinormalisasi otomatis ke format 62.</p><button className="primary" disabled={!!busy}>{busy === 'save' ? 'Menyimpan...' : editingId ? 'Simpan perubahan' : 'Tambah kontak'}</button>{editingId && <button type="button" disabled={!!busy} onClick={resetForm}>Batal edit</button>}</form>
    </div>
  </>
}

function TemplatesPage({ notify }: { notify: Notify }) {
  const defaultContent = 'Halo {{nama}},\n\nKami menyampaikan informasi terbaru dari Pemerintah Desa. Silakan ikuti petunjuk yang tercantum dalam pesan ini.\n\nTerima kasih.'
  const [items, setItems] = useState<Template[]>([])
  const [name, setName] = useState('Informasi Desa')
  const [content, setContent] = useState(defaultContent)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const load = () => api<Template[]>('/api/templates').then(setItems)
  useEffect(() => { void load().catch(() => undefined) }, [])
  function resetForm() { setEditingId(null); setName('Informasi Desa'); setContent(defaultContent) }
  function edit(template: Template) { setEditingId(template.id); setName(template.name); setContent(template.content) }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true)
    try { await api(editingId ? `/api/templates/${editingId}` : '/api/templates', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ name, content }) }); await load(); notify(editingId ? 'Template berhasil diperbarui' : 'Template berhasil disimpan'); resetForm() }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Template gagal disimpan') }
    finally { setBusy(false) }
  }
  async function setActive(template: Template, active: boolean) {
    if (!active && !window.confirm(`Nonaktifkan template ${template.name}? Campaign yang sudah dibuat tidak berubah.`)) return
    setBusy(true)
    try { await api(`/api/templates/${template.id}`, active ? { method: 'PATCH', body: JSON.stringify({ isActive: true }) } : { method: 'DELETE' }); await load(); notify(active ? 'Template diaktifkan kembali' : 'Template dinonaktifkan') }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Status template gagal diperbarui') }
    finally { setBusy(false) }
  }

  return <div className="split-layout"><section className="panel grow"><div className="panel-head"><div><h2>Template tersimpan</h2><p>Gunakan <code>{'{{nama}}'}</code> untuk personalisasi nama penerima.</p></div><span className="count-pill">{items.length} template</span></div><div className="template-list">{items.map((template) => <article className="template-card" key={template.id}><div><div><strong>{template.name}</strong><StatusBadge value={template.isActive ? 'Aktif' : 'Nonaktif'} tone={template.isActive ? 'success' : 'neutral'} /></div><div className="row-actions"><button disabled={busy} onClick={() => edit(template)}>Edit</button><button disabled={busy} onClick={() => setActive(template, !template.isActive)}>{template.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></div><pre>{template.content}</pre></article>)}{!items.length && <div className="table-empty">Belum ada template pesan.</div>}</div></section>
    <form className="panel side-form wide" onSubmit={submit}><div className="form-title"><span className="form-icon"><Icon name="file" /></span><div><p className="section-kicker">{editingId ? 'EDIT TEMPLATE' : 'TEMPLATE BARU'}</p><h2>{editingId ? 'Perbarui isi pesan' : 'Tulis pesan'}</h2></div></div><label>Nama template<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Isi pesan<textarea required rows={10} value={content} onChange={(event) => setContent(event.target.value)} /></label><div className="message-preview"><small>PRATINJAU</small><p>{content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi')}</p></div><button className="primary" disabled={busy}>{busy ? 'Menyimpan...' : editingId ? 'Simpan perubahan' : 'Simpan template'}</button>{editingId && <button type="button" disabled={busy} onClick={resetForm}>Batal edit</button>}</form>
  </div>
}

function CampaignsPage({ notify }: { notify: Notify }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [recipientSearch, setRecipientSearch] = useState('')
  const [name, setName] = useState('Informasi Desa')
  const [templateId, setTemplateId] = useState('')
  const [batchSize, setBatchSize] = useState(10)
  const [useBanner, setUseBanner] = useState(false)
  const [useInteractiveCta, setUseInteractiveCta] = useState(false)
  const [settings, setSettings] = useState<CampaignSettings | null>(null)
  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState('')

  const load = async () => {
    const [campaignData, templateData, contactData, campaignSettings] = await Promise.all([api<Campaign[]>('/api/campaigns'), api<Template[]>('/api/templates'), api<Contact[]>('/api/contacts'), api<CampaignSettings>('/api/campaigns/settings')])
    const eligible = contactData.filter((contact) => contact.isActive && contact.whatsappOptIn)
    setCampaigns(campaignData); setTemplates(templateData); setContacts(eligible); setSettings(campaignSettings)
    setSelectedIds((current) => current.filter((id) => eligible.some((contact) => contact.id === id)))
    const firstActive = templateData.find((template) => template.isActive)
    if (!templateId && firstActive) setTemplateId(firstActive.id)
  }
  useEffect(() => { void load().catch(() => undefined) }, [])
  useEffect(() => { const timer = window.setInterval(() => void api<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => undefined), 8000); return () => window.clearInterval(timer) }, [])

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId), [templates, templateId])
  const visibleContacts = useMemo(() => contacts.filter((contact) => contact.fullName.toLowerCase().includes(recipientSearch.toLowerCase()) || contact.phoneNormalized.includes(recipientSearch)), [contacts, recipientSearch])
  const detectedUrl = useMemo(() => firstHttpsUrl(selectedTemplate?.content ?? ''), [selectedTemplate])
  const payload = () => ({ name, templateId, batchSize, useBanner, useInteractiveCta, contactIds: selectedIds })
  const invalidate = () => setPreview(null)

  async function runPreview() {
    setBusy('preview')
    try { setPreview(await api<CampaignPreview>('/api/campaigns/preview', { method: 'POST', body: JSON.stringify(payload()) })) }
    catch (caught) { setPreview(null); notify(caught instanceof Error ? caught.message : 'Pratinjau campaign gagal dibuat') }
    finally { setBusy('') }
  }
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!preview) return void runPreview()
    if (busy) return
    setBusy('create')
    try { const result = await api<{ recipientCount: number }>('/api/campaigns', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...payload(), previewToken: preview.previewToken }) }); setPreview(null); setIdempotencyKey(crypto.randomUUID()); await load(); notify(`Draft campaign dibuat untuk ${result.recipientCount} kontak`) }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Campaign gagal dibuat') }
    finally { setBusy('') }
  }
  async function action(id: string, actionName: string) {
    if (actionName === 'start' && !window.confirm('Mulai campaign ini? Pesan akan diproses pada jadwal dispatcher berikutnya.')) return
    if (actionName === 'cancel' && !window.confirm('Batalkan campaign ini? Pesan yang masih mengantre tidak akan dikirim.')) return
    setBusy(`${id}-${actionName}`)
    try { await api(`/api/campaigns/${id}/${actionName}`, { method: 'POST' }); await load(); notify('Status campaign berhasil diperbarui') }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Status campaign gagal diperbarui') }
    finally { setBusy('') }
  }
  function toggleContact(id: string) { invalidate(); setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }

  return <div className="split-layout campaign-layout"><section className="panel grow"><div className="panel-head"><div><h2>Campaign terbaru</h2><p>Progres diperbarui otomatis setiap 8 detik.</p></div><span className="live-indicator"><i /> Live</span></div><div className="campaign-list">{campaigns.map((campaign) => {
    const progress = campaign.recipientCount ? Math.round((campaign.sentCount / campaign.recipientCount) * 100) : 0
    return <article className="campaign-card" key={campaign.id}><div className="campaign-row"><div><div className="title-line"><strong>{campaign.name}</strong><StatusBadge value={campaignStatus[campaign.status] ?? campaign.status} tone={['RUNNING', 'COMPLETED'].includes(campaign.status) ? 'success' : campaign.status === 'CANCELLED' ? 'danger' : 'neutral'} /></div><p>{formatDate(campaign.createdAt)} | Batch {campaign.batchSize} | {campaign.useBanner ? 'Banner' : 'Teks'}{campaign.useInteractiveCta ? ' + tombol' : ''}</p></div><div className="row-actions">{campaign.status === 'DRAFT' && <button disabled={!!busy} onClick={() => action(campaign.id, 'start')}>Mulai</button>}{campaign.status === 'RUNNING' && <button disabled={!!busy} onClick={() => action(campaign.id, 'pause')}>Jeda</button>}{campaign.status === 'PAUSED' && <button disabled={!!busy} onClick={() => action(campaign.id, 'resume')}>Lanjutkan</button>}{['DRAFT', 'RUNNING', 'PAUSED'].includes(campaign.status) && <button className="danger-button" disabled={!!busy} onClick={() => action(campaign.id, 'cancel')}>Batalkan</button>}</div></div><div className="campaign-progress"><div><span style={{ width: `${progress}%` }} /></div><p><strong>{campaign.sentCount}/{campaign.recipientCount} diserahkan</strong><span>{campaign.deliveredCount} terkirim | {campaign.readCount} dibaca | {campaign.failedCount} gagal</span></p></div></article>
  })}{!campaigns.length && <div className="table-empty">Belum ada campaign.</div>}</div></section>

    <form className="panel side-form campaign-composer" onSubmit={create}><div className="form-title"><span className="form-icon"><Icon name="send" /></span><div><p className="section-kicker">CAMPAIGN BARU</p><h2>Siapkan pengiriman</h2></div></div><div className="form-grid"><label>Nama campaign<input required value={name} onChange={(event) => { setName(event.target.value); invalidate() }} /></label><label>Ukuran batch<input type="number" min={1} max={50} value={batchSize} onChange={(event) => { setBatchSize(Number(event.target.value)); invalidate() }} /></label></div><label>Template pesan<select required value={templateId} onChange={(event) => { setTemplateId(event.target.value); invalidate() }}><option value="">Pilih template</option>{templates.filter((template) => template.isActive).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <div className="option-grid"><label className="toggle-row"><input type="checkbox" checked={useBanner} onChange={(event) => { setUseBanner(event.target.checked); invalidate() }} /><span><strong>Gunakan banner</strong><small>Kirim gambar dengan caption.</small></span></label><label className={`toggle-row ${!settings?.interactiveCtaEnabled ? 'disabled' : ''}`}><input type="checkbox" checked={useInteractiveCta} disabled={!settings?.interactiveCtaEnabled} onChange={(event) => { setUseInteractiveCta(event.target.checked); invalidate() }} /><span><strong>Tombol tindakan</strong><small>{settings?.interactiveCtaEnabled ? 'Buka tautan langsung dari pesan.' : 'Belum diaktifkan pada server.'}</small></span></label></div>
      {useInteractiveCta && <div className={detectedUrl ? 'cta-detected' : 'inline-alert danger'}><Icon name={detectedUrl ? 'link' : 'alert'} /><span>{detectedUrl ? <><strong>{settings?.interactiveCtaLabel}</strong><small>{detectedUrl}</small></> : 'Template harus memiliki URL HTTPS.'}</span></div>}
      <fieldset className="recipient-picker"><legend>Penerima ({selectedIds.length}/{contacts.length})</legend><div className="recipient-toolbar"><div className="search-box small"><Icon name="search" /><input placeholder="Cari penerima" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} /></div><div><button type="button" onClick={() => { setSelectedIds(contacts.map((contact) => contact.id)); invalidate() }}>Semua</button><button type="button" onClick={() => { setSelectedIds([]); invalidate() }}>Kosongkan</button></div></div><div className="recipient-list">{visibleContacts.map((contact) => <label className="checkbox-row" key={contact.id}><input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} /><span>{contact.fullName}<small>+{contact.phoneNormalized}</small></span></label>)}{!visibleContacts.length && <p className="hint">Tidak ada penerima yang cocok.</p>}</div></fieldset>
      <div className="message-preview phone-preview">{(preview?.useBanner ? preview.bannerUrl : useBanner ? settings?.defaultBannerUrl : null) && <img className="message-banner-preview" src={(preview?.bannerUrl ?? settings?.defaultBannerUrl) || ''} alt="Banner campaign" />}<small>{preview ? `PRATINJAU FINAL - ${preview.recipientCount} PENERIMA` : 'PRATINJAU PESAN'}</small><p>{preview?.samples[0]?.renderedMessage ?? selectedTemplate?.content.replace(/{{\s*nama\s*}}/gi, 'Ahmad Fauzi') ?? 'Pilih template untuk melihat isi pesan.'}</p>{(preview?.useInteractiveCta || useInteractiveCta) && detectedUrl && <span className="cta-button-preview"><Icon name="link" /> {preview?.ctaLabel ?? settings?.interactiveCtaLabel}</span>}</div>
      <div className="composer-actions"><button type="button" onClick={runPreview} disabled={!!busy || !templateId || !selectedIds.length || (useInteractiveCta && !detectedUrl)}>{busy === 'preview' ? 'Menyiapkan...' : 'Tinjau'}</button><button className="primary" disabled={!!busy || !preview}>{busy === 'create' ? 'Membuat...' : preview ? 'Buat draft' : 'Tinjau dahulu'}</button></div>
    </form>
  </div>
}

function HistoryPage({ notify }: { notify: Notify }) {
  const [items, setItems] = useState<Message[]>([])
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async (silent = false) => { if (!silent) setLoading(true); try { setItems(await api<Message[]>('/api/messages')) } catch (caught) { if (!silent) notify(caught instanceof Error ? caught.message : 'Riwayat tidak dapat dimuat') } finally { if (!silent) setLoading(false) } }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 7000); return () => window.clearInterval(timer) }, [])
  const filtered = useMemo(() => items.filter((item) => { const matchesStatus = status === 'ALL' || item.status === status || item.deliveryStatus === status; const needle = search.trim().toLowerCase(); return matchesStatus && (!needle || item.recipient.includes(needle) || item.renderedMessage.toLowerCase().includes(needle)) }), [items, search, status])
  const counts = useMemo(() => ({ submitted: items.filter((item) => item.status === 'SENT').length, delivered: items.filter((item) => ['DELIVERED', 'READ', 'PLAYED'].includes(item.deliveryStatus ?? '')).length, failed: items.filter((item) => item.status === 'FAILED' || item.deliveryStatus === 'ERROR').length }), [items])
  async function retry(message: Message) {
    const uncertain = message.deliveryStatus === 'UNKNOWN'
    const warning = uncertain ? 'Status pesan ini belum dapat dipastikan. Mengantrekan ulang tetap berisiko menghasilkan pesan ganda. Lanjutkan?' : 'Antrekan ulang pesan ini pada dispatcher berikutnya?'
    if (!window.confirm(warning)) return
    try { await api(`/api/messages/${message.id}/retry`, { method: 'POST' }); await load(); notify('Pesan kembali masuk antrean') }
    catch (caught) { notify(caught instanceof Error ? caught.message : 'Pesan gagal diantrekan ulang') }
  }

  return <section className="panel"><div className="panel-head"><div><h2>Riwayat pengiriman</h2><p>Menampilkan 200 pekerjaan terbaru dengan status pengantaran.</p></div><button onClick={() => load()} disabled={loading}><Icon name="refresh" /> {loading ? 'Memuat' : 'Segarkan'}</button></div><div className="history-summary"><span><i className="submitted" />{counts.submitted} diserahkan</span><span><i className="delivered" />{counts.delivered} terkirim</span><span><i className="failed" />{counts.failed} perlu perhatian</span></div><div className="filter-bar"><div className="search-box"><Icon name="search" /><input placeholder="Cari nomor atau isi pesan" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Semua status</option><option value="QUEUED">Dalam antrean</option><option value="PROCESSING">Diproses</option><option value="SENT">Diserahkan</option><option value="SERVER_ACK">Diterima server</option><option value="DELIVERED">Terkirim</option><option value="READ">Dibaca</option><option value="UNKNOWN">Tidak pasti</option><option value="FAILED">Gagal</option></select><span>{filtered.length} hasil</span></div><div className="table-wrap"><table><thead><tr><th>Penerima</th><th>Pesan</th><th>Proses</th><th>Pengantaran</th><th>Waktu</th><th className="action-column">Aksi</th></tr></thead><tbody>{filtered.map((message) => {
    const canRetry = message.status === 'FAILED' || (message.status === 'SENT' && ['ERROR', 'UNKNOWN'].includes(message.deliveryStatus ?? ''))
    return <tr key={message.id}><td className="mono">+{message.recipient}</td><td className="message-cell">{message.renderedMessage}{message.errorMessage && <small className="job-error">{message.errorCode}: {message.errorMessage}</small>}</td><td><StatusBadge value={jobStatus[message.status] ?? message.status} tone={message.status === 'FAILED' ? 'danger' : message.status === 'SENT' ? 'success' : 'neutral'} /><small className="cell-note">Percobaan {message.attempts}/{message.maxAttempts}</small></td><td><StatusBadge value={message.deliveryStatus ? deliveryStatus[message.deliveryStatus] ?? message.deliveryStatus : message.status === 'SENT' ? 'Belum dilacak' : '-'} tone={['DELIVERED', 'READ', 'PLAYED'].includes(message.deliveryStatus ?? '') ? 'success' : ['ERROR', 'UNKNOWN'].includes(message.deliveryStatus ?? '') ? 'danger' : 'neutral'} /></td><td>{formatDate(message.sentAt ?? message.createdAt)}</td><td>{canRetry && <button onClick={() => retry(message)}>Antrekan ulang</button>}</td></tr>
  })}{!filtered.length && <tr><td colSpan={6}><div className="table-empty">{loading ? 'Memuat riwayat...' : items.length ? 'Tidak ada hasil yang cocok.' : 'Belum ada aktivitas pengiriman.'}</div></td></tr>}</tbody></table></div><p className="safety-note"><Icon name="alert" /> Pesan dengan status tidak pasti tidak dikirim ulang otomatis untuk mencegah duplikasi.</p></section>
}

function WhatsappPage({ notify }: { notify: Notify }) {
  const [state, setState] = useState<WhatsappState | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'replace' | null>(null)
  const load = () => api<WhatsappState>('/api/whatsapp/status').then(setState)
  useEffect(() => { void load().catch(() => undefined); const timer = window.setInterval(() => void load().catch(() => undefined), 3000); return () => window.clearInterval(timer) }, [])
  async function connect() { setBusy('connect'); try { setState(await api('/api/whatsapp/connect', { method: 'POST' })); notify('Proses koneksi WhatsApp dimulai') } catch (caught) { notify(caught instanceof Error ? caught.message : 'WhatsApp gagal dihubungkan') } finally { setBusy(null) } }
  async function disconnect() { if (!window.confirm('Hentikan koneksi WhatsApp saat ini? Session tetap tersimpan dan dapat digunakan kembali.')) return; setBusy('disconnect'); try { setState(await api('/api/whatsapp/disconnect', { method: 'POST' })); notify('Koneksi dihentikan tanpa menghapus session') } catch (caught) { notify(caught instanceof Error ? caught.message : 'Koneksi gagal dihentikan') } finally { setBusy(null) } }
  async function replaceAccount() {
    if (!window.confirm('Ganti akun WhatsApp? Session akun lama akan dihapus permanen dan Anda harus memindai QR menggunakan akun baru. Pastikan tidak ada campaign yang sedang berjalan.')) return
    setBusy('replace')
    try {
      setState(await api('/api/whatsapp/replace-account', { method: 'POST' }))
      notify('Session lama dihapus. Pindai QR untuk menghubungkan akun baru.')
    } catch (caught) { notify(caught instanceof Error ? caught.message : 'Akun WhatsApp gagal diganti') }
    finally { setBusy(null) }
  }
  const connected = state?.status === 'CONNECTED'

  return <div className="whatsapp-grid"><section className="panel connection-card"><span className={`wa-icon ${connected ? 'online' : ''}`}><Icon name="message" /></span><p className="section-kicker">STATUS PERANGKAT</p><h2>{whatsappStatus[state?.status ?? ''] ?? 'Memuat status...'}</h2><p>{state?.phoneNumber ? `+${state.phoneNumber}` : 'Belum ada nomor yang terhubung'}</p><div className="connection-facts"><SystemRow label="Session persisten" text="Tersimpan terenkripsi" /><SystemRow label="Pemulihan otomatis" text="Aktif setelah restart" /></div><div className="connection-actions">{!connected ? <button className="primary" disabled={!!busy || state?.status === 'CONNECTING'} onClick={connect}>{busy === 'connect' ? 'Menghubungkan...' : 'Hubungkan WhatsApp'}</button> : <button disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? 'Menghentikan...' : 'Hentikan koneksi'}</button>}{state?.phoneNumber && <button className="danger-button" disabled={!!busy} onClick={replaceAccount}>{busy === 'replace' ? 'Menghapus session...' : 'Ganti akun WhatsApp'}</button>}</div></section><section className="panel qr-card"><div className="panel-head"><div><h2>Hubungkan perangkat</h2><p>Buka WhatsApp Business, pilih Perangkat tertaut, lalu pindai QR.</p></div><StatusBadge value={connected ? 'Siap mengirim' : 'Belum siap'} tone={connected ? 'success' : 'neutral'} /></div>{state?.qrDataUrl ? <img className="qr" src={state.qrDataUrl} alt="QR untuk menghubungkan WhatsApp" /> : <div className={`qr-placeholder ${connected ? 'complete' : ''}`}><span><Icon name={connected ? 'check' : 'qr'} /></span><strong>{connected ? 'Perangkat sudah terhubung' : state?.status === 'CONNECTING' ? 'Menyiapkan QR...' : 'QR belum tersedia'}</strong><p>{connected ? 'Session akan dipulihkan otomatis setelah server restart.' : 'Klik Hubungkan WhatsApp untuk membuat QR baru.'}</p></div>}</section></div>
}

function Metric({ label, value, helper, icon, tone }: { label: string; value: number; helper: string; icon: IconName; tone?: string }) { return <article className={`metric ${tone ?? ''}`}><div><span>{label}</span><i><Icon name={icon} /></i></div><strong>{value.toLocaleString('id-ID')}</strong><small>{helper}</small></article> }
function SystemRow({ label, text, ok = true }: { label: string; text: string; ok?: boolean }) { return <div className="system-row"><span className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'alert'} /></span><div><strong>{label}</strong><small>{text}</small></div></div> }
function StatusBadge({ value, tone = 'neutral' }: { value: string; tone?: 'success' | 'danger' | 'neutral' }) { return <span className={`badge ${tone}`}>{value}</span> }
function Loading() { return <div className="loading"><span className="spinner" /> Memuat data...</div> }
function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="panel empty"><span><Icon name="alert" /></span><h2>{title}</h2><p>{text}</p>{action}</div> }
function formatDate(value: string | null | undefined) { return value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-' }
function formatTime(value: Date | null) { return value?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) ?? '-' }
function firstHttpsUrl(text: string) { return text.match(/https:\/\/[^\s<>"']+/i)?.[0]?.replace(/[.,!?;:]+$/, '') }

type IconName = 'grid' | 'users' | 'send' | 'file' | 'history' | 'message' | 'refresh' | 'upload' | 'check' | 'alert' | 'search' | 'edit' | 'link' | 'qr'
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    history: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></>,
    upload: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 21h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    alert: <><path d="M12 3 2 21h20Z"/><path d="M12 9v5M12 18h.01"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/></>,
    qr: <><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h2v2h-2zM19 15h2v6h-6v-2"/></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
