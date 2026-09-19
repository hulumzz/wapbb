# WA PBB Reminder — Blueprint

> Dokumen ini adalah sumber konteks utama untuk developer/AI agent yang mengerjakan repository ini. Jangan hapus file ini. Jika arsitektur atau keputusan penting berubah, perbarui dokumen ini bersama perubahan kode.

## 1. Ringkasan proyek

WA PBB Reminder adalah aplikasi standalone untuk mengelola kontak dan mengirim pesan pengingat WhatsApp secara terkontrol. Tahap pertama sengaja dibuat generik dan sederhana: data penerima hanya membutuhkan **nama lengkap** dan **nomor telepon/WhatsApp**. Data PBB seperti NOP, nominal, RT/RW, tahun pajak, dan status pembayaran baru akan ditambahkan pada fase integrasi dengan SID Desa.

Target pilot awal: sekitar **100 kontak**.

Aplikasi harus ringan agar dapat dijalankan pada resource kecil (termasuk Render Free), tidak menggunakan Chromium/Puppeteer, tidak bergantung pada filesystem lokal untuk state penting, dan mudah diintegrasikan ke SID Laravel di masa depan.

## 2. Tujuan V1

V1 harus menyediakan:

1. UI admin yang clean dan sederhana.
2. Manajemen kontak: nama lengkap + nomor WhatsApp.
3. Input manual dan import CSV/XLSX (import XLSX dapat diselesaikan pada iterasi berikutnya bila belum tersedia pada commit awal).
4. Normalisasi nomor Indonesia ke format internasional, misalnya `08123456789` menjadi `628123456789`.
5. Template pesan dengan variabel minimal `{{nama}}`.
6. Campaign untuk memilih penerima dan menghasilkan antrean pesan.
7. Database-backed queue agar pekerjaan tidak hilang ketika server restart/redeploy.
8. Batch dispatcher dengan ukuran batch configurable, default 10 pesan per dispatch.
9. Riwayat pengiriman dan status message job.
10. Modul koneksi WhatsApp menggunakan Baileys tanpa Chromium/Puppeteer.
11. Persistensi session WhatsApp di PostgreSQL, bukan file lokal.
12. REST API agar nantinya SID dapat mengintegrasikan service ini tanpa mengetahui detail Baileys.

## 3. Non-goals V1

Belum menjadi fokus awal:

- NOP PBB.
- nominal PBB.
- status lunas/belum lunas.
- RT/RW dan detail wajib pajak lain.
- multi-tenant.
- banyak akun WhatsApp sekaligus.
- CRM/chat inbox lengkap.
- Redis/RabbitMQ.
- browser automation.
- mekanisme untuk mengakali anti-spam WhatsApp.

Batch/rate limiting dibuat untuk kontrol beban, observabilitas, dan keselamatan operasional. Pengiriman hanya ditujukan kepada penerima yang memang berhak/bersedia menerima komunikasi terkait layanan desa.

## 4. Stack

### Frontend

- React 19
- Vite 8
- TypeScript
- CSS biasa pada bootstrap awal; Tailwind dapat ditambahkan jika memang dibutuhkan setelah struktur UI stabil.

### Backend

- Node.js 20+
- TypeScript
- Fastify 5
- Zod 4
- Drizzle ORM
- PostgreSQL

### WhatsApp

- Baileys 7 (saat blueprint dibuat, package latest masih release candidate)
- WebSocket langsung; tidak ada Chromium/Puppeteer.

### Deployment

- Backend: Render Web Service atau platform Node serupa.
- Frontend: dapat di-serve terpisah sebagai static app atau kemudian dibundle/serve dari backend.
- Database: PostgreSQL persisten (Neon/Supabase/existing PostgreSQL). Jangan mengandalkan ephemeral filesystem Render untuk session.
- Scheduler production: trigger eksternal ke endpoint internal dispatcher. Jangan bergantung pada `setTimeout`, `sleep`, atau in-process cron jika instance dapat sleep.

## 5. Prinsip arsitektur

### 5.1 Database-driven, bukan process-driven

State penting harus berada di database:

- contacts
- templates
- campaigns
- message jobs
- logs
- WhatsApp auth/session

Server boleh mati kapan saja. Saat hidup kembali, pekerjaan harus dapat dilanjutkan dari database tanpa mengulang pesan yang sudah sukses.

### 5.2 Provider abstraction

Business logic tidak boleh mengimpor Baileys secara langsung dari module campaign/queue.

Gunakan interface provider:

```ts
interface MessagingProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<MessagingStatus>
  sendText(input: SendTextInput): Promise<SendResult>
  sendImage(input: SendImageInput): Promise<SendResult>
}
```

Implementasi awal:

```text
MessagingProvider
└── BaileysProvider
```

Nanti dapat ditambah:

```text
MessagingProvider
├── BaileysProvider
└── OfficialWhatsAppProvider
```

Tanpa menulis ulang contacts, campaigns, queue, dan UI.

### 5.3 Queue harus idempotent

Dispatcher tidak boleh menyebabkan penerima mendapat pesan yang sama dua kali hanya karena endpoint dipanggil dua kali.

Message jobs memiliki lifecycle:

```text
QUEUED -> PROCESSING -> SENT
                    -> FAILED
       -> SKIPPED
       -> CANCELLED
```

Pengambilan job harus atomic/transactional pada implementasi database production.

## 6. Struktur repository

Target struktur:

```text
wapbb/
├── blueprint.md
├── README.md
├── package.json
├── .gitignore
├── .env.example
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.ts
│   │       ├── server.ts
│   │       ├── config.ts
│   │       ├── db/
│   │       │   ├── client.ts
│   │       │   └── schema.ts
│   │       ├── modules/
│   │       │   ├── contacts/
│   │       │   ├── campaigns/
│   │       │   ├── templates/
│   │       │   ├── messages/
│   │       │   └── whatsapp/
│   │       ├── providers/
│   │       │   └── whatsapp/
│   │       └── utils/
│   └── web/
│       ├── package.json
│       ├── index.html
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── styles.css
└── .github/
    └── workflows/
        └── dispatcher.yml (fase deployment)
```

Struktur boleh berkembang, tetapi pisahkan `web`, `api`, business logic, database, dan provider WhatsApp.

## 7. Model data V1

### 7.1 contacts

```text
id
full_name
phone
phone_normalized
is_active
whatsapp_opt_in
created_at
updated_at
```

`phone` menyimpan input asli bila dibutuhkan untuk audit/UI.
`phone_normalized` menjadi nomor canonical untuk pengiriman.

### 7.2 message_templates

```text
id
name
content
is_active
created_at
updated_at
```

Variabel awal:

- `{{nama}}`

Template renderer harus sederhana dan predictable. Jangan mengeksekusi arbitrary code.

### 7.3 campaigns

```text
id
name
template_id
status
batch_size
use_banner
use_interactive_cta
cta_label
cta_footer
idempotency_key
request_hash
created_at
updated_at
started_at
completed_at
```

Status awal:

```text
DRAFT
RUNNING
PAUSED
COMPLETED
CANCELLED
```

### 7.4 campaign_recipients

Mengikat campaign ke snapshot penerima.

```text
id
campaign_id
contact_id
created_at
```

### 7.5 message_jobs

```text
id
campaign_id
contact_id
recipient
rendered_message
status
attempts
max_attempts
scheduled_at
processing_at
sent_at
provider_message_id
delivery_status
server_ack_at
delivered_at
read_at
cta_url
cta_label
cta_footer
error_code
error_message
created_at
updated_at
```

### 7.6 whatsapp_accounts

Untuk V1 cukup satu akun aktif, tetapi schema jangan mengunci kemungkinan multi-account.

```text
id
label
phone_number
status
connected_at
last_seen_at
created_at
updated_at
```

### 7.7 whatsapp_auth

Session credential dan Signal keys tidak boleh hanya disimpan di file lokal.

Implementasi akhir dapat berupa tabel terpisah untuk credentials/keys atau key-value encrypted store. Payload sensitif harus dienkripsi menggunakan secret dari environment.

## 8. Normalisasi nomor

Aturan awal Indonesia:

```text
08123456789   -> 628123456789
8123456789    -> 628123456789
+628123456789 -> 628123456789
628123456789  -> 628123456789
```

Normalisasi:

1. trim whitespace.
2. hapus spasi, `-`, `(`, `)` dan karakter dekoratif umum.
3. hapus leading `+`.
4. `0xxxxxxxx` -> `62xxxxxxxx`.
5. `8xxxxxxxx` -> `628xxxxxxxx`.
6. validasi hanya digit dan panjang masuk akal.

Jangan mengirim ke nomor yang gagal validasi.

## 9. Flow UI

Menu V1:

```text
Dashboard
Kontak
Campaign
Template Pesan
Riwayat
WhatsApp
```

### Dashboard

Tampilkan ringkas:

- jumlah kontak aktif
- campaign aktif
- queued
- sent
- failed
- status koneksi WhatsApp

### Kontak

Fitur:

- tambah kontak
- edit/nonaktifkan/aktifkan kembali
- search nama/nomor
- pilih banyak kontak
- import CSV/XLSX dengan preview dan hasil per baris

Kontrak import V1:

- maksimal total 1.000 baris dan 5 MB per file pada UI;
- header wajib `Nama Lengkap` dan `Nomor WhatsApp`, sedangkan `Opt In` opsional;
- baris tanpa nama, tanpa nomor, atau dengan jumlah digit nomor di luar 10-14 dilewati;
- nilai opt-in yang kosong atau kolomnya tidak tersedia diperlakukan sebagai opt-in; operator wajib memastikan file hanya memuat penerima yang sudah memberikan persetujuan;
- seluruh sheet XLSX yang memiliki kedua header wajib digabung, sedangkan sheet tanpa header kontak diabaikan;
- parsing CSV/XLSX dan preview dilakukan di browser, tetapi validasi serta normalisasi server tetap menjadi sumber kebenaran;
- nomor duplikat dalam file atau yang sudah ada di database dilewati, bukan ditimpa;
- baris invalid tidak menggagalkan seluruh file dan harus dilaporkan dengan nomor barisnya.

Kolom awal hanya:

```text
Nama | Nomor WhatsApp | Status
```

### Campaign wizard

Urutan:

```text
1. Detail campaign
2. Pilih penerima
3. Pilih/tulis template
4. Preview
5. Confirm
```

Preview wajib menampilkan jumlah target dan beberapa sample rendered message sebelum campaign dibuat.

### WhatsApp

State:

```text
DISCONNECTED
CONNECTING
QR_READY
CONNECTED
NEEDS_REAUTH
```

Ketika QR tersedia, UI menampilkannya. Saat session valid dan server restart, backend harus restore session dari database tanpa QR ulang.

## 10. Flow campaign dan queue

```text
Admin membuat campaign
        ↓
Validasi target aktif + opt-in
        ↓
Generate campaign recipients
        ↓
Render message snapshot per recipient
        ↓
Generate message_jobs = QUEUED
        ↓
Dispatcher dipanggil
        ↓
Ambil maksimal batch_size job eligible
        ↓
PROCESSING
        ↓
Provider.sendText() / Provider.sendImage()
        ↓
SENT / FAILED
```

`SENT` dipertahankan sebagai nama status queue agar migration tetap kompatibel dengan versi `main`, tetapi semantiknya adalah **payload sudah diserahkan ke koneksi WhatsApp**, bukan bukti penerima sudah mendapat pesan. Konfirmasi aktual disimpan terpisah:

```text
PENDING -> SERVER_ACK -> DELIVERED -> READ / PLAYED
                         -> ERROR
        -> UNKNOWN
```

UI wajib memakai istilah "Diserahkan" untuk `SENT`, lalu menampilkan `delivery_status` secara terpisah. Receipt yang datang tidak boleh menurunkan status yang sudah lebih tinggi.

Default `batch_size = 10`.

Batch size bukan jaminan bypass anti-spam. Nilainya harus configurable dan digunakan untuk operasional bertahap.

## 11. Dispatcher

Endpoint internal target:

```http
POST /internal/dispatch
Authorization: Bearer <INTERNAL_DISPATCH_SECRET>
```

Syarat:

- endpoint dilindungi secret.
- hanya mengambil job pada campaign RUNNING.
- hanya mengambil job QUEUED/eligible.
- menghormati batch_size.
- jika WhatsApp tidak connected, jangan menandai seluruh queue gagal.
- jika connection failure beruntun terjadi, hentikan batch/circuit break.

Jangan membuat logic seperti:

```text
send 10
sleep 10 menit
send 10
```

Lebih baik scheduler eksternal memanggil dispatcher pada interval yang dipilih. Dengan begitu server boleh sleep/restart.

## 12. Retry

Temporary error dapat retry dengan batas, misalnya `max_attempts = 3`.

Permanent error (nomor invalid dan sejenisnya) tidak perlu retry tanpa batas.

Field minimal:

```text
attempts
max_attempts
error_code
error_message
```

## 13. WhatsApp session persistence

Ini requirement kritis karena proyek lama berbasis Puppeteer pernah kehilangan/reconnect session saat storage tidak persisten.

Dilarang menjadikan filesystem ephemeral production sebagai sumber session utama.

Target flow:

```text
Server start
   ↓
load encrypted auth state from PostgreSQL
   ↓
Baileys connect
   ↓
CONNECTED
```

Jika benar-benar logout/device removed:

```text
status = NEEDS_REAUTH
```

Admin scan QR baru.

## 14. Security

- `DATABASE_URL`, session encryption key, admin secret, dan dispatcher secret hanya melalui environment variable.
- jangan commit `.env`.
- jangan log credential/session Signal.
- sanitasi error sebelum dikirim ke frontend.
- dashboard production wajib authentication.
- endpoint internal dispatcher wajib secret.
- CORS hanya mengizinkan origin frontend yang dikonfigurasi.
- data kontak adalah data pribadi; tampilkan seperlunya dan batasi akses admin.

## 15. Environment variables

Target:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://...
WEB_ORIGIN=http://localhost:5173
INTERNAL_DISPATCH_SECRET=change-me
WA_SESSION_ENCRYPTION_KEY=change-me-32-byte-secret
```

Tambahkan auth credential admin saat modul authentication dibuat.

## 16. API target

### Health/dashboard

```http
GET /health
GET /api/dashboard
```

### Contacts

```http
GET    /api/contacts
POST   /api/contacts
PATCH  /api/contacts/:id
DELETE /api/contacts/:id
```

### Templates

```http
GET    /api/templates
POST   /api/templates
PATCH  /api/templates/:id
DELETE /api/templates/:id
```

### Campaigns

```http
GET  /api/campaigns
POST /api/campaigns
GET  /api/campaigns/:id
POST /api/campaigns/:id/start
POST /api/campaigns/:id/pause
POST /api/campaigns/:id/resume
POST /api/campaigns/:id/cancel
```

### Messages

```http
GET /api/messages
GET /api/messages/:id
```

### WhatsApp

```http
GET  /api/whatsapp/status
POST /api/whatsapp/connect
POST /api/whatsapp/disconnect
GET  /api/whatsapp/qr
```

### Internal

```http
POST /internal/dispatch
```

## 17. Integrasi SID masa depan

Core WA Reminder harus tetap generic.

SID dapat menjadi sumber business context:

```text
SID Laravel
    ↓
filter wajib pajak / data PBB
    ↓
WA Reminder REST API
    ↓
queue
    ↓
MessagingProvider
```

Contoh future payload:

```json
{
  "recipient": "628123456789",
  "name": "Ahmad Fauzi",
  "template": "pbb-reminder",
  "variables": {
    "nop": "33.26.xxx",
    "nominal": "125000",
    "tahun": "2026"
  }
}
```

Jangan masukkan semua domain PBB ke core messaging sebelum integrasi SID memang dikerjakan.

## 18. Fase pengerjaan

### Phase 1 — Foundation

- monorepo npm workspaces
- React/Vite UI shell
- Fastify API
- env/config
- PostgreSQL/Drizzle schema
- contacts CRUD

### Phase 2 — Messaging UI

- templates CRUD
- campaign wizard
- queue/riwayat UI
- mock status WhatsApp

### Phase 3 — Baileys

- provider abstraction
- QR connection
- DB-backed auth state
- reconnect strategy
- connection state UI

### Phase 4 — Queue production

- atomic job claim
- batch dispatcher
- retry/circuit breaker
- logs
- external scheduler workflow

### Phase 5 — Pilot

Uji bertahap:

```text
internal 5 nomor
→ 10
→ 25
→ ±100
```

Validasi duplicate protection, reconnect, session persistence, formatting, queue recovery, dan error handling.

### Phase 6 — SID integration

- integration API
- sync context PBB
- payment-aware cancellation bila diperlukan

## 19. Definition of done V1

V1 dianggap siap pilot ketika:

- UI dapat dibuka dan digunakan.
- contact CRUD berjalan.
- nama + nomor menjadi data minimal.
- nomor dinormalisasi konsisten.
- campaign dapat menghasilkan message jobs.
- queue tersimpan di PostgreSQL.
- dispatcher memproses batch tanpa duplicate send.
- restart server tidak menghapus queue.
- restart/redeploy tidak mengharuskan QR ulang selama session masih valid.
- status WhatsApp terlihat dari UI.
- failed job tercatat dan dapat dianalisis.
- ketika tidak ada campaign RUNNING, dispatcher mengembalikan sukses/no-op walaupun WhatsApp sedang disconnected.
- blueprint ini masih berada di repository dan diperbarui bila keputusan arsitektur berubah.

## 20. Aturan untuk agent/developer berikutnya

1. Baca `blueprint.md` sebelum mengubah arsitektur.
2. Jangan menghapus provider abstraction hanya untuk mempercepat integrasi Baileys.
3. Jangan simpan session production hanya ke local files.
4. Jangan mengganti queue database dengan in-memory queue.
5. Jangan menambah Chromium/Puppeteer kecuali ada keputusan arsitektur eksplisit baru.
6. Jangan memperumit domain PBB sebelum core messaging stabil.
7. Prioritaskan kode ringan, jelas, typed, dan mudah dipindahkan ke deployment resource kecil.
8. Setiap perubahan schema/API yang signifikan harus diikuti update blueprint ini.

## 21. Status implementasi terbaru (2026-09-16)

Messaging engine V1 kini menggunakan keputusan operasional berikut:

- Kandidat production dikerjakan di branch `production/messaging-v1`; branch `main` tetap menjadi baseline stabil yang dapat dideploy kembali. Migration production harus tetap aditif dan kompatibel dengan kode `main`.
- Tombol native-flow CTA tidak lagi diperlakukan sebagai mode eksperimen global. Campaign memiliki `use_interactive_cta`, sedangkan URL/label/footer disalin ke setiap message job agar retry deterministik. `INTERACTIVE_CTA_ENABLED` tetap menjadi kill switch server dan default-nya mati; jika dimatikan, job CTA dikirim melalui jalur text/image biasa tanpa tombol.
- Dispatcher menyimpan stable provider message ID sebelum relay. Setelah relay berhasil, queue memakai status kompatibel `SENT` dengan arti "diserahkan" dan `delivery_status=PENDING`. Event `messages.update` Baileys memetakan acknowledgement menjadi `SERVER_ACK`, `DELIVERED`, `READ`, `PLAYED`, atau `ERROR` beserta timestamp.
- Error dengan `deliveryUncertain=true` tidak pernah masuk retry otomatis. Job menjadi `FAILED` dengan `delivery_status=UNKNOWN`; retry hanya dapat dilakukan manual dengan peringatan risiko duplikasi. Bila acknowledgement sudah tersimpan walaupun pemanggilan send melempar error, job dipulihkan sebagai `SENT` dan tidak diulang.
- UI production menggunakan label operasional berbahasa Indonesia, membedakan proses queue dari pengantaran, menyediakan CTA per campaign, dan tidak lagi menampilkan helper eksperimen/pilot sebagai identitas produk.
- Pembuatan campaign menerima header `Idempotency-Key`. Payload yang sama mengembalikan draft yang sudah terbentuk, sedangkan penggunaan key yang sama untuk payload berbeda ditolak. Ini mencegah draft/queue ganda ketika respons create timeout atau operator mengirim ulang form.

- Schema dikelola dengan migration SQL versioned di `apps/api/drizzle/`; `db:push` bukan lagi alur deployment utama. Render menjalankan migration terkompilasi sebelum API start. Koneksi memakai driver `pg`/Drizzle; `sslmode=require` dari URL Neon dinormalisasi runtime menjadi `verify-full` untuk mempertahankan verifikasi sertifikat pada versi driver mendatang.
- Auth-state Baileys disimpan per akun/key di tabel `whatsapp_auth`, dienkripsi AES-256-GCM, dan ciphertext versi baru memakai AAD `accountId:key`. Pembacaan payload lama tanpa field versi tetap didukung. Update sekumpulan Signal keys dijalankan dalam transaksi database.
- Disconnect manual tidak menghapus session. Event logout, bad session, atau multidevice mismatch menghapus auth-state rusak agar connect berikutnya dapat menghasilkan QR baru. Reconnect transient memakai exponential backoff sampai 60 detik.
- Campaign UI sudah mendukung pemilihan kontak aktif yang opt-in dan preview server-side. Preview menampilkan jumlah penerima serta maksimal tiga snapshot pesan sebelum konfirmasi pembuatan draft.
- Import kontak CSV/XLSX sudah tersedia melalui UI. XLSX dibaca secara lazy di browser, server memvalidasi ulang maksimal 1.000 baris, nomor dinormalisasi, dan konflik nomor dilewati secara aman. UI juga menampilkan preview dan ringkasan berhasil/duplikat/invalid.
- Dashboard, daftar campaign, dan riwayat kini mempunyai refresh berkala/umpan balik proses. Campaign menampilkan progres terkirim/antre/gagal; riwayat dapat dicari dan difilter; aksi final meminta konfirmasi.
- UI template sekarang mendukung edit, nonaktifkan, dan aktifkan kembali agar konsisten dengan kontrak API.
- Claim dispatcher memakai `FOR UPDATE SKIP LOCKED`, processing token unik, batas batch campaign, serta unique constraint `(campaign_id, contact_id)`. Attempts dinaikkan saat claim dan update hasil hanya berlaku untuk token pemilik claim.
- Setiap job menggunakan message ID Baileys stabil yang diturunkan dari ID job. Error sementara dijadwalkan ulang dengan exponential backoff dan batch dihentikan saat koneksi provider jatuh.
- Job `PROCESSING` yang melewati timeout tidak otomatis diulang karena hasil kirim dapat tidak pasti. Job dipindah ke `FAILED` dengan `DELIVERY_UNKNOWN_AFTER_RESTART`; retry harus dipicu admin dari halaman Riwayat. Ini adalah kompromi V1 untuk memprioritaskan duplicate-send prevention.
- Retry manual job dilakukan dalam transaksi yang sama dengan penguncian job dan campaign. Jika job berada pada campaign `COMPLETED`, campaign dibuka kembali menjadi `RUNNING` agar dispatcher dapat memprosesnya; campaign `CANCELLED` tidak pernah dihidupkan kembali.
- API admin dilindungi JWT dan rate limit; login dibatasi lebih ketat. `/internal/dispatch` memakai bearer secret dengan constant-time comparison. `/health` memeriksa koneksi database.
- Vite hanya membaca file environment di `apps/web`; `.env` root dikhususkan untuk backend agar `NODE_ENV` dan secret backend tidak memengaruhi atau ikut diproses build frontend.
- Pesan teks memakai generator link preview Baileys dengan `link-preview-js` 5.0.0 (patch SSRF) dan high-quality preview diaktifkan. Peer optional Baileys rc14 masih meminta versi 3; `.npmrc` mengizinkan versi yang dipin/diuji, bukan mengembalikan dependensi rentan. Kegagalan metadata/thumbnail tidak menggagalkan pengiriman teks.
- Campaign memiliki flag `use_banner`. Jika aktif, API mengambil `DEFAULT_BANNER_URL` ke buffer memory sementara (timeout 15 detik, maksimal 5 MB), lalu Baileys mengirim image dengan snapshot pesan sebagai caption. File/base64 banner tidak disimpan ke database atau filesystem; kegagalan sumber media dicatat pada message job dan mengikuti aturan retry yang sama.
- Dispatcher melakukan pengecekan campaign RUNNING sebelum status provider. Panggilan scheduler saat antrean campaign kosong menjadi no-op HTTP 200 sehingga tidak dilaporkan sebagai kegagalan hanya karena WhatsApp sedang disconnected.

Migration dan smoke test health/login/dashboard terhadap Neon telah berhasil pada 2026-09-16; tujuh tabel aplikasi dan tiga migration baseline terkonfirmasi. Migration keempat menambahkan CTA snapshot/delivery receipt dan migration kelima menambahkan idempotency campaign; keduanya bersifat aditif dan sudah diterapkan ke Neon. Pairing WhatsApp, satu pengiriman pilot, serta restore session setelah API restart juga berhasil: status kembali `CONNECTED` tanpa QR baru. Link-preview metadata, payload image+caption, dan satu native-flow CTA sudah diterima pada perangkat uji; dispatch bertahap 5 -> 10 -> 25 -> sekitar 100 nomor serta receipt lintas Android/iOS/Web tetap wajib sebelum pilot penuh. Domain PBB kompleks tetap non-goal V1.

## 22. Integrasi SIDDes dan hardening (2026-09-17)

Keputusan terbaru menggantikan rencana sync konteks PBB pada Phase 6: Laravel SIDDes menjadi frontend operasional blast **informasi umum**, WAPBB tetap backend tersendiri di Render/Neon. Satu master kontak bersama berisi nama perwakilan rumah dan WhatsApp; tidak ada hubungan KK/penduduk, domain pembayaran, auto-send publikasi, upload, multi-account atau multi-tenant. React tetap panel cadangan.

- Implementasi pada `production/siddes-messaging`; `main` tetap tidak diubah. SIDDes pada `feature/whatsapp-messaging`. Kedua workflow WAPBB (CI dan dispatcher) dihapus; workflow Android SIDDes tidak diubah. Scheduler eksternal POST setiap 10 menit tetap menjadi pemicu queue.
- `messaging_leases` mengunci socket per akun dengan owner UUID per proses (heartbeat 30 detik, expiry 90 detik) dan dispatcher per akun. Gangguan pembaruan lease menghentikan socket/pengiriman. Versi lama tidak menghormati lease: matikan instance lama sebelum menggunakan versi ini.
- Setup gagal tidak bertahan CONNECTING; gangguan transient memakai exponential backoff. Ciphertext auth tidak dapat didekripsi menjadi NEEDS_REAUTH; connect eksplisit pemilik lease boleh mereset auth rusak. Credentials/Signal keys disnapshot dan disimpan serial; clear menghentikan penulisan sebelum delete. Shutdown menghentikan socket lalu menunggu auth maksimal 10 detik sebelum database ditutup. Status menyertakan reason/changedAt/authPersistence, bukan auth-state.
- Dispatcher mengklaim satu job setiap tahap hingga batas batch/budget 25 detik; campaign/claim/consent/nomor diperiksa ulang sebelum relay. Opt-out/nonaktif/nomor berubah menjadi SKIPPED; pause/cancel menghentikan relay berikutnya. Completion dan retry mengunci campaign sebelum job. Deadline sebelum relay aman diulang; timeout setelah relay UNKNOWN, menutup socket dan tidak auto-resend.
- `message_attempts` menyimpan provider ID dan generation. Retry manual menghasilkan generasi baru; receipt lama hanya memperbarui attempt lama. Receipt bersifat monotonik. Metadata outbound encrypted untuk `getMessage` mempertahankan proto teks/image/CTA dan descriptor media, tetapi membuang thumbnail dan tidak menyimpan bytes banner/base64 gambar. Percobaan historis di-backfill dengan receipt yang memang sudah ada, tanpa mengarang receipt atau payload lama.
- Banner baru memakai snapshot URL konfigurasi saat draft dibuat. Unduhan streaming dihentikan pada 5 MB, timeout 15 detik, MIME PNG/JPEG/WebP dan signature format diperiksa. Campaign lama dengan banner_url null masih memakai environment agar tidak mengarang snapshot historis. Footer CTA kosong valid; kill switch memakai jalur pesan biasa, bukan pengiriman kedua sebagai fallback.
- `messaging_audit` menyimpan actor/sumber/aksi/object ID bila tersedia/waktu/kode hasil untuk mutation kontak/template/campaign/retry/koneksi. Actor header bukan hak akses. Secret/ciphertext tidak dicatat pada error log API.

### Kontrak integrasi

`/integration/v1` memakai handler bisnis yang sama dengan `/api/*`. Dua bearer key environment terpisah minimal 32 karakter: `SID_OPERATOR_API_KEY` untuk operasional dan `SID_ADMIN_API_KEY` untuk operasional+koneksi/QR. Key integrasi tidak berlaku untuk login JWT atau dispatcher; preview JWT tidak berlaku untuk API admin. Key kosong menonaktifkan scope tersebut. QR disensor pada respons operator termasuk dashboard/status.

Resource: `dashboard`, `contacts` (detail/mutation/import), `templates`, `campaigns/settings`, `campaigns/preview`, `campaigns` (detail/start/pause/resume/cancel), `campaigns/by-request/:uuid`, `messages` (detail/retry), dan `whatsapp/status|qr|connect|disconnect`. List integrasi memakai envelope `{items,pagination:{page,perPage,total,lastPage}}`, default 20/max100, pencarian/filter server-side.

Campaign integrasi menerima `name`, `content` final maksimal4000, `templateId` optional, `contactIds` eksplisit 1–1000, `batchSize`, `useBanner`, `useInteractiveCta`. Template referensi tidak diubah saat content diedit. Preview mengembalikan sample, jumlah target, pilihan media/CTA dan `previewToken` signed 15 menit yang mengikat payload, konfigurasi media dan versi data penerima. Create wajib previewToken + UUID `Idempotency-Key`; replay sukses dilakukan sebelum cek expiry token. Payload/key berbeda ditolak409; perubahan penerima mewajibkan preview ulang. Lookup UUID dipakai untuk rekonsiliasi timeout.

Migration 0005 aditif: template_id nullable, content_snapshot/banner_url, generation serta tiga tabel hardening. Data lama tetap dipertahankan. Migration telah diuji pada PostgreSQL terisolasi, **belum dijalankan pada Neon produksi untuk integrasi ini**.

### Laravel dan rollout

Menu Pesan WhatsApp memakai Blade/layout admin yang sama, CSS/JS scoped. Browser hanya menghubungi Laravel dengan CSRF; Laravel memeriksa role dan memilih key berdasarkan aksi. GET connect timeout5s/total10s; mutation15s tanpa retry otomatis. MySQL hanya menyimpan ledger submission (UUID, actor, hash, status, campaign ID); kontak/queue/session tidak diduplikasi. Form timeout mempertahankan UUID dan menyediakan lookup; draft tidak auto-start. Flag `MESSAGING_ENABLED` defaultfalse. Panduan lengkap berada di SIDDes `docs/whatsapp-messaging.md`.

Deploy WAPBB/migration dahulu, kemudian SIDDes/ledger migration dengan flag mati, lalu aktifkan sesudah smoke test. Jangan mengganti encryption key. Warm-up GET `/health` dua menit sebelum POST dispatch mengurangi cold-start tetapi tidak menjamin selesai dalam timeout cron30s. Health dan lease heartbeat menggunakan Neon; compute idle dapat tetap aktif karena traffic tersebut.

Rollback SIDDes dengan feature flagfalse. Rollback WAPBB harus menghentikan versi baru sebelum menghidupkan versi lama; migration boleh tetap ada. **Draft direct-content baru tidak dapat diproses oleh baseline main yang mengharuskan template**: pause/cancel dan pertahankan draft tersebut, jangan menganggap rollback semantik otomatis. Tidak ada janji exactly-once delivery atau CTA lintas seluruh klien.

Validasi otomatis menggunakan provider fake + PostgreSQL ephemeral, Http::fake + SQLite Laravel, unit parser/media dan build. Pengiriman WhatsApp aktual, browser desktop/mobile, restart/logout HP dan cold start deployment tetap acceptance manual; jangan mengirim pada kontak produksi tanpa izin.

Node runtime minimal22.19 (dependency preview patched); Render `NODE_VERSION=22`. Link preview menggunakan fetch dengan DNS public yang dipin ke koneksi, termasuk redirect dan `og:image`; bytes thumbnail dibatasi dan diresize sebelum upload media Baileys. `sharp` adalah dependency eksplisit supaya image+caption tidak bergantung pada peer optional hasil install. `getPreviewFromContent` dipakai untuk parsing tanpa HTTP tersembunyi. Metadata outbound tetap membuang thumbnail sebelum encryption/database.

Catatan validasi integrasi lokal: test API47 + React3, Laravel modul10 (49assertions) + parserSID2 telah lolos; typecheck/build WAPBB, build SIDDes, db:check, migration PostgreSQL ephemeral, migration ledgerSQLite, route/view cache dan HTTP health API fake-provider serta frontend Vite terverifikasi. Audit runtime WAPBB tidak menemukan vulnerability; empat advisory moderate pada tooling dev Drizzle/esbuild belum diremediasi dengan upgrade breaking. Browser in-app tidak tersedia, sehingga tidak ada klaim uji visual desktop/mobile atau pengiriman WhatsApp aktual pada perubahan integrasi ini. Audit mutation bersifat best-effort: kegagalan write audit dicatat, bukan mengulang mutation yang sudah berhasil.
