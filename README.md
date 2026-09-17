# Layanan Pesan WhatsApp Desa

Backend messaging ringan untuk informasi umum desa, dengan panel React cadangan dan integrasi admin Laravel SIDDes. Scope V1: nama perwakilan rumah + nomor WhatsApp, template/pesan langsung, campaign, queue, riwayat, dan koneksi WhatsApp. Tidak terhubung KK atau status pembayaran.

> Baca [`blueprint.md`](./blueprint.md) sebelum mengubah arsitektur. Dokumen tersebut adalah sumber konteks utama project dan harus tetap berada di repository.

## Stack

- React 19 + Vite 8 + TypeScript
- Fastify 5 + TypeScript
- PostgreSQL + Drizzle ORM
- Baileys 7 untuk WhatsApp WebSocket (tanpa Chromium/Puppeteer)
- JWT untuk login admin

## Menjalankan lokal

1. Gunakan Node.js 22.19 atau lebih baru (termasuk dependensi link preview yang telah diperbarui).
2. Copy `.env.example` menjadi `.env` di root repository.
3. Isi minimal:
   - `DATABASE_URL`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `AUTH_SECRET`
   - `INTERNAL_DISPATCH_SECRET`
   - `WA_SESSION_ENCRYPTION_KEY`
   - `DEFAULT_BANNER_URL` (opsional; sudah memiliki default banner PBB)
4. Install dependency:

```bash
npm install
```

5. Jalankan migration versioned ke database (termasuk Neon):

```bash
npm run db:migrate
```

6. Jalankan API:

```bash
npm run dev:api
```

7. Pada terminal lain jalankan UI:

```bash
npm run dev:web
```

Untuk URL API frontend non-default, copy `apps/web/.env.example` menjadi `apps/web/.env.local` lalu ubah `VITE_API_URL`. Frontend sengaja tidak membaca `.env` root agar konfigurasi dan secret backend tetap terpisah.

UI default: `http://localhost:5173`  
API default: `http://localhost:3000`

Login menggunakan nilai `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari environment.

### Impor kontak

Menu Kontak menerima file `.csv` dan `.xlsx` sampai 1.000 baris atau 5 MB. Baris pertama harus memuat kolom `Nama Lengkap` dan `Nomor WhatsApp`; kolom `Opt In` opsional. Bila nilai opt-in tidak tersedia atau tidak eksplisit, kontak disimpan sebagai opt-out dan tidak eligible untuk campaign. Format header umum seperti `nama`, `phone`, dan `no whatsapp` juga dikenali.

File dibaca dan dipreview di browser, kemudian server tetap melakukan validasi dan normalisasi nomor Indonesia. Baris invalid dilewati dengan laporan nomor baris, sedangkan nomor duplikat di file maupun database tidak ditambahkan ulang.

## Endpoint utama

Public:

- `GET /health`
- `POST /auth/login`

Admin JWT:

- `GET /api/dashboard`
- CRUD `/api/contacts`
- `POST /api/contacts/import`
- CRUD `/api/templates`
- `/api/campaigns`
- `GET /api/messages`
- `/api/whatsapp/*`

Internal scheduler:

- `POST /internal/dispatch` dengan `Authorization: Bearer <INTERNAL_DISPATCH_SECRET>`

## Session WhatsApp

Session Baileys tidak disimpan sebagai folder lokal. Credentials dan Signal keys disimpan di PostgreSQL melalui custom auth state dan dienkripsi menggunakan AES-256-GCM dari `WA_SESSION_ENCRYPTION_KEY`. Key minimal 32 karakter dan harus dipertahankan antar-redeploy; menggantinya membuat session lama tidak dapat didekripsi.

Flow normal setelah login pertama:

```text
server restart / redeploy
        ↓
load auth state dari PostgreSQL
        ↓
Baileys reconnect
        ↓
CONNECTED
```

QR baru hanya diperlukan ketika akun benar-benar logout, perangkat dihapus, atau session sudah tidak valid.

## Dispatcher

Message tidak dikirim memakai proses `sleep()` panjang. Campaign menghasilkan queue di PostgreSQL. Scheduler eksternal memanggil `POST /internal/dispatch`, lalu dispatcher mengambil maksimal satu batch job yang eligible secara atomic dengan `FOR UPDATE SKIP LOCKED` dan processing token.

Setiap job memakai message ID provider yang stabil dari ID job dan ID tersebut dicatat sebelum relay dimulai. Error sementara yang dipastikan belum terkirim dijadwalkan ulang dengan backoff sampai `max_attempts`. Error dengan hasil kirim tidak pasti serta job `PROCESSING` yang stale dipindahkan ke `FAILED`/`UNKNOWN`, bukan otomatis dikirim ulang. Admin harus memeriksa lalu memilih **Antrekan ulang** dari halaman Riwayat; kebijakan konservatif ini mengurangi risiko pesan ganda.

Status queue `SENT` dipertahankan untuk kompatibilitas rollback `main`, tetapi UI menampilkannya sebagai **Diserahkan**. Receipt Baileys disimpan terpisah sebagai `SERVER_ACK`, `DELIVERED`, `READ`, `PLAYED`, `ERROR`, atau `UNKNOWN`.

Default batch saat ini adalah 10, tetapi dapat diubah per campaign. Batch digunakan untuk kontrol operasional dan resource, bukan sebagai jaminan untuk menghindari sistem anti-spam WhatsApp.

Campaign default text-only; banner opsional memakai snapshot `DEFAULT_BANNER_URL` saat draft dibuat. Bytes hanya di memory sementara, tidak di database/filesystem; caption memakai pesan final. Link preview dan thumbnail memakai DNS tervalidasi/pinned (termasuk redirect), batas ukuran/waktu, dan high-quality media Baileys. Kegagalan preview tidak membatalkan pengiriman teks.

### Tombol tindakan WhatsApp

Campaign dapat menambahkan tombol URL melalui toggle **Tombol tindakan**. Fitur tersedia ketika `INTERACTIVE_CTA_ENABLED=true` dan template memiliki URL HTTPS. Label serta footer dikonfigurasi melalui `INTERACTIVE_CTA_LABEL` dan `INTERACTIVE_CTA_FOOTER`, kemudian disalin ke message job agar retry tetap deterministik.

Kill switch default tetap `false`. Setelah pilot perangkat berhasil, aktifkan environment tersebut di API Render. Jika kill switch dimatikan ketika masih ada job ber-CTA, dispatcher mengirim snapshot pesan sebagai text/image biasa. Kegagalan relay yang hasilnya tidak pasti tidak pernah diikuti fallback atau retry otomatis karena dapat menghasilkan pesan ganda.

Fitur memakai native-flow protokol WhatsApp Web melalui Baileys. Status receipt membedakan pesan yang baru diserahkan, diterima server, terkirim ke perangkat, dan dibaca. Receipt perangkat tidak menjamin setiap versi aplikasi merender tombol dengan tampilan identik, sehingga pilot lintas Android/iOS/Web tetap diperlukan.

Workflow GitHub telah dihapus. Gunakan cron-job.org: POST `/internal/dispatch`, bearer `INTERNAL_DISPATCH_SECRET`, header JSON, body `{}`, setiap10menit, timeout30detik. Warm-up GET `/health` dua menit sebelumnya opsional; cold start Render tetap dapat melampaui timeout.

## Deploy ke Render

Repository sudah memiliki `render.yaml` untuk dua service:

- `wapbb-api` — Node web service
- `wapbb-web` — static frontend

Saat membuat Blueprint di Render, isi environment yang masih `sync: false`:

### API

- `DATABASE_URL`
- `WEB_ORIGIN` — URL frontend production
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `DEFAULT_BANNER_URL` — opsional bila ingin mengganti banner bawaan
- `INTERACTIVE_CTA_ENABLED` — ubah ke `true` setelah pilot tombol tindakan berhasil
- `INTERACTIVE_CTA_LABEL` dan `INTERACTIVE_CTA_FOOTER` — label produksi yang disalin ke job

`AUTH_SECRET`, `INTERNAL_DISPATCH_SECRET`, dan `WA_SESSION_ENCRYPTION_KEY` disiapkan untuk digenerate oleh Render. Simpan nilai `INTERNAL_DISPATCH_SECRET` jika scheduler eksternal akan digunakan.

### Frontend

- `VITE_API_URL` — URL service `wapbb-api`, tanpa trailing slash

Service API menjalankan migration terkompilasi sebelum start. Untuk lokal, jalankan `npm run db:migrate` dengan `DATABASE_URL` yang sama. File migration versioned berada di `apps/api/drizzle/`; URL Neon dengan `sslmode=require` dinormalisasi runtime menjadi `verify-full` agar verifikasi sertifikat tetap kuat pada versi driver mendatang.

## Status implementasi V1

Sudah tersedia sebagai fondasi:

- UI dashboard clean dan responsive
- login admin JWT
- CRUD dasar kontak
- import kontak CSV/XLSX dengan preview, validasi per baris, dan deduplikasi
- normalisasi nomor Indonesia
- template pesan `{{nama}}`
- campaign + database-backed message jobs
- batch dispatcher dengan PostgreSQL row locking
- halaman riwayat
- QR/status WhatsApp
- Baileys provider abstraction
- encrypted PostgreSQL-backed Baileys auth state
- restore session + reconnect exponential backoff
- preview server-side dan pemilihan penerima campaign
- link preview WhatsApp dan opsi campaign image + caption menggunakan banner statis
- retry/backoff, circuit breaker, stale-job recovery konservatif, dan retry manual
- migration SQL versioned serta startup migration di Render
- Render Blueprint
- API integrasi SIDDes dengan scope admin/operator, pagination, signed preview dan idempotensi
- session/dispatcher lease, metadata outbound encrypted dan generasi attempt

Belum selesai/divalidasi:

- dispatch bertahap lebih dari satu penerima (5 → 10 → 25 → sekitar 100)
- domain PBB seperti NOP, nominal, RT/RW, dan status pembayaran

Bagian tersebut sengaja tetap di luar core awal sebagaimana dijelaskan di `blueprint.md`.

## Validasi lokal dan integrasi SIDDes

Jalankan `npm run typecheck`, `npm test`, `npm run build`, dan `npm run db:check`. Test konkurensi memakai PostgreSQL ephemeral di tempdir, bukan DATABASE_URL produksi. Node minimal22.19; `sharp` dipin untuk thumbnail/media image. `.npmrc` mengizinkan patched link-preview-js5 walaupun peer optional Baileys masih versi3; jangan memakai versi rentan hanya untuk menghilangkan warning peer `npm ls`.

Isi `SID_OPERATOR_API_KEY` dan `SID_ADMIN_API_KEY` di environment API Render, masing-masing random minimal32karakter dan berbeda. Nilai yang sama disimpan server-side Laravel sebagai `MESSAGING_OPERATOR_API_KEY`/`MESSAGING_ADMIN_API_KEY`. Laravel memakai `MESSAGING_API_URL` dan flag `MESSAGING_ENABLED`; browser tidak menerima key. Panduan lengkap SIDDes berada di `docs/whatsapp-messaging.md`; kontrak dan rollback tercatat di blueprint bagian22. Jangan menjalankan API lokal dan Render pada session/database produksi yang sama.

## Catatan keamanan

Baileys adalah library tidak resmi dan project ini bukan alat untuk spam/bulk messaging tanpa izin. Gunakan hanya untuk penerima yang memang berhak/bersedia menerima komunikasi.

Jangan commit `.env`, session, credential, atau secret. Data kontak merupakan data pribadi dan dashboard production harus tetap berada di balik autentikasi admin.
