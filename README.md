# WA PBB Reminder

Aplikasi standalone ringan untuk mengelola kontak dan antrean reminder WhatsApp. Scope V1 sengaja sederhana: **nama lengkap + nomor WhatsApp**, template pesan, campaign, queue, history, dan koneksi WhatsApp.

> Baca [`blueprint.md`](./blueprint.md) sebelum mengubah arsitektur. Dokumen tersebut adalah sumber konteks utama project dan harus tetap berada di repository.

## Stack

- React 19 + Vite 8 + TypeScript
- Fastify 5 + TypeScript
- PostgreSQL + Drizzle ORM
- Baileys 7 untuk WhatsApp WebSocket (tanpa Chromium/Puppeteer)

## Menjalankan lokal

1. Gunakan Node.js 20 atau lebih baru.
2. Copy `.env.example` menjadi `.env` di root repository.
3. Isi `DATABASE_URL`, `INTERNAL_DISPATCH_SECRET`, dan `WA_SESSION_ENCRYPTION_KEY`.
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

## Endpoint utama

- `GET /health`
- `GET /api/dashboard`
- CRUD `/api/contacts`
- CRUD `/api/templates`
- `/api/campaigns`
- `GET /api/messages`
- `/api/whatsapp/*`
- `POST /internal/dispatch`

## Dispatcher

Message tidak dikirim memakai proses `sleep()` panjang. Campaign menghasilkan queue di PostgreSQL. Scheduler eksternal memanggil `POST /internal/dispatch`, lalu dispatcher mengambil maksimal satu batch job yang eligible.

Workflow contoh tersedia di `.github/workflows/dispatcher.yml`. Tambahkan repository secrets:

- `DISPATCH_URL`, contoh `https://service.example.com/internal/dispatch`
- `DISPATCH_SECRET`, harus sama dengan `INTERNAL_DISPATCH_SECRET`

## Catatan keamanan

Baileys adalah library tidak resmi dan project ini bukan alat untuk spam/bulk messaging tanpa izin. Batch digunakan untuk kontrol operasional dan resource. Gunakan hanya untuk penerima yang memang berhak/bersedia menerima komunikasi.

Session WhatsApp disiapkan untuk disimpan ke PostgreSQL dalam bentuk terenkripsi. Jangan commit file session atau `.env`.
