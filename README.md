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

1. Gunakan Node.js 20 atau lebih baru.
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

5. Push schema ke database development:

```bash
npm run db:push
```

6. Jalankan API:

```bash
npm run dev:api
```

7. Pada terminal lain jalankan UI:

```bash
npm run dev:web
```

UI default: `http://localhost:5173`  
API default: `http://localhost:3000`

Login menggunakan nilai `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari environment.

## Endpoint utama

Public:

- `GET /health`
- `POST /auth/login`

Admin JWT:

- `GET /api/dashboard`
- CRUD `/api/contacts`
- CRUD `/api/templates`
- `/api/campaigns`
- `GET /api/messages`
- `/api/whatsapp/*`

Internal scheduler:

- `POST /internal/dispatch` dengan `Authorization: Bearer <INTERNAL_DISPATCH_SECRET>`

## Session WhatsApp

Session Baileys tidak disimpan sebagai folder lokal. Credentials dan Signal keys disimpan di PostgreSQL melalui custom auth state dan dienkripsi menggunakan `WA_SESSION_ENCRYPTION_KEY`.

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

Message tidak dikirim memakai proses `sleep()` panjang. Campaign menghasilkan queue di PostgreSQL. Scheduler eksternal memanggil `POST /internal/dispatch`, lalu dispatcher mengambil maksimal satu batch job yang eligible.

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

Sebelum aplikasi pertama kali digunakan, jalankan schema PostgreSQL menggunakan `npm run db:push` dengan `DATABASE_URL` yang sama.

## Status implementasi V1

Sudah tersedia sebagai fondasi:

- UI dashboard clean dan responsive
- login admin JWT
- CRUD dasar kontak
- normalisasi nomor Indonesia
- template pesan `{{nama}}`
- campaign + database-backed message jobs
- batch dispatcher dengan PostgreSQL row locking
- halaman riwayat
- QR/status WhatsApp
- Baileys provider abstraction
- encrypted PostgreSQL-backed Baileys auth state
- restore session + reconnect sementara
- Render Blueprint
- scheduler workflow

Belum diselesaikan pada bootstrap awal:

- import CSV/XLSX melalui UI
- pemilihan kontak individual pada campaign UI
- retry policy lanjutan/circuit breaker lengkap
- domain PBB seperti NOP, nominal, RT/RW, dan status pembayaran

Bagian tersebut sengaja tetap di luar core awal sebagaimana dijelaskan di `blueprint.md`.

## CI

`.github/workflows/ci.yml` disiapkan untuk menjalankan install, typecheck, dan build pada push/PR.

Jika workflow tidak mendapatkan runner dan berhenti sebelum step pertama, periksa ketersediaan/izin GitHub Actions pada repository atau akun. Kondisi tersebut berbeda dari kegagalan compile pada source code.

## Catatan keamanan

Baileys adalah library tidak resmi dan project ini bukan alat untuk spam/bulk messaging tanpa izin. Gunakan hanya untuk penerima yang memang berhak/bersedia menerima komunikasi.

Jangan commit `.env`, session, credential, atau secret. Data kontak merupakan data pribadi dan dashboard production harus tetap berada di balik autentikasi admin.
