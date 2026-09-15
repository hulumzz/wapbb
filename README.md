# WA PBB Reminder

Aplikasi standalone ringan untuk mengelola kontak dan antrean reminder WhatsApp. Scope V1 sengaja sederhana: **nama lengkap + nomor WhatsApp**, template pesan, campaign, queue, history, dan koneksi WhatsApp.

> Baca [`blueprint.md`](./blueprint.md) sebelum mengubah arsitektur. Dokumen tersebut adalah sumber konteks utama project dan harus tetap berada di repository.

## Stack

- React 19 + Vite 8 + TypeScript
- Fastify 5 + TypeScript
- PostgreSQL + Drizzle ORM
- Baileys 7 untuk WhatsApp WebSocket (tanpa Chromium/Puppeteer)
- JWT untuk login admin

## Menjalankan lokal

1. Gunakan Node.js 20.19 atau lebih baru (sesuai requirement Vite 8).
2. Copy `.env.example` menjadi `.env` di root repository.
3. Isi minimal:
   - `DATABASE_URL`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `AUTH_SECRET`
   - `INTERNAL_DISPATCH_SECRET`
   - `WA_SESSION_ENCRYPTION_KEY`
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

Setiap job memakai message ID provider yang stabil dari ID job. Error sementara dijadwalkan ulang dengan backoff sampai `max_attempts`. Jika worker berhenti saat status job masih `PROCESSING`, job stale dipindahkan ke `FAILED` dengan kode `DELIVERY_UNKNOWN_AFTER_RESTART`, bukan otomatis dikirim ulang. Admin harus memeriksa lalu memilih Retry dari halaman Riwayat; kebijakan konservatif ini mengurangi risiko duplicate-send ketika provider sebenarnya sudah menerima pesan tetapi respons belum sempat disimpan.

Default batch saat ini adalah 10, tetapi dapat diubah per campaign. Batch digunakan untuk kontrol operasional dan resource, bukan sebagai jaminan untuk menghindari sistem anti-spam WhatsApp.

Workflow contoh tersedia di `.github/workflows/dispatcher.yml`. Tambahkan repository secrets:

- `DISPATCH_URL`, contoh `https://service.example.com/internal/dispatch`
- `DISPATCH_SECRET`, harus sama dengan `INTERNAL_DISPATCH_SECRET`

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
- retry/backoff, circuit breaker, stale-job recovery konservatif, dan retry manual
- migration SQL versioned serta startup migration di Render
- Render Blueprint
- scheduler workflow

Belum selesai/divalidasi:

- dispatch bertahap lebih dari satu penerima (5 → 10 → 25 → sekitar 100)
- domain PBB seperti NOP, nominal, RT/RW, dan status pembayaran

Bagian tersebut sengaja tetap di luar core awal sebagaimana dijelaskan di `blueprint.md`.

## CI

`.github/workflows/ci.yml` disiapkan untuk menjalankan install, typecheck, dan build pada push/PR.

Jika workflow tidak mendapatkan runner dan berhenti sebelum step pertama, periksa ketersediaan/izin GitHub Actions pada repository atau akun. Kondisi tersebut berbeda dari kegagalan compile pada source code.

## Catatan keamanan

Baileys adalah library tidak resmi dan project ini bukan alat untuk spam/bulk messaging tanpa izin. Gunakan hanya untuk penerima yang memang berhak/bersedia menerima komunikasi.

Jangan commit `.env`, session, credential, atau secret. Data kontak merupakan data pribadi dan dashboard production harus tetap berada di balik autentikasi admin.
