/**
 * migrate-data.mjs
 * Migrasi data langsung dari Neon → Prisma Postgres tanpa pg_dump.
 * Strategi: baca semua baris dari Neon, INSERT ke Prisma Postgres dengan ON CONFLICT DO NOTHING.
 *
 * Jalankan: node scripts/migrate-data.mjs
 */

// Gunakan pg dari root node_modules (hoisted oleh npm workspaces)
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../.env') })

const require = createRequire(import.meta.url)
const pg = require('../node_modules/pg/lib/index.js')

// ── URL koneksi: ambil dari env atau argumen CLI ─────────────────────────────
// Contoh penggunaan:
// node scripts/migrate-data.mjs "<SOURCE_URL>" "<DEST_DIRECT_URL>"
const NEON_URL   = process.argv[2] ?? process.env.SRC_DATABASE_URL
const PRISMA_URL = process.argv[3] ?? process.env.DEST_DATABASE_URL ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL

// ── Urutan tabel harus mengikuti dependency FK ───────────────────────────────
// Parent sebelum child
const TABLES = [
  'message_templates',
  'contacts',
  'campaigns',
  'campaign_recipients',
  'whatsapp_accounts',
  'whatsapp_auth',
  'message_jobs',
  'message_attempts',
  'messaging_leases',
  'delivery_safety',
  'messaging_audit',
  'drizzle_migrations',   // tracking migrasi Drizzle ikut dipindah
]

// ── Helper: format nilai untuk log ──────────────────────────────────────────
function fmtCount(n) {
  return n.toString().padStart(5)
}

// ── Helper: buat placeholders $1,$2,... ─────────────────────────────────────
function placeholders(cols, offset = 0) {
  return cols.map((_, i) => `$${i + 1 + offset}`).join(', ')
}

// ── Migrasi satu tabel ───────────────────────────────────────────────────────
async function migrateTable(src, dst, table) {
  // Baca semua baris dari Neon
  const { rows } = await src.query(`SELECT * FROM "${table}"`)
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(30)} — kosong, skip`)
    return { total: 0, inserted: 0, skipped: 0 }
  }

  const cols     = Object.keys(rows[0])
  const colList  = cols.map(c => `"${c}"`).join(', ')
  const sql      = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders(cols)}) ON CONFLICT DO NOTHING`

  let inserted = 0
  let skipped  = 0

  for (const row of rows) {
    const values = cols.map(c => row[c])
    const result = await dst.query(sql, values)
    if (result.rowCount > 0) inserted++
    else skipped++
  }

  console.log(`  ${table.padEnd(30)} — total:${fmtCount(rows.length)}  inserted:${fmtCount(inserted)}  skipped:${fmtCount(skipped)}`)
  return { total: rows.length, inserted, skipped }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const src = new pg.Pool({ connectionString: NEON_URL,   max: 2, ssl: { rejectUnauthorized: false } })
  const dst = new pg.Pool({ connectionString: PRISMA_URL, max: 2, ssl: { rejectUnauthorized: false } })

  console.log('='.repeat(60))
  console.log('  Migrasi data: Neon → Prisma Postgres')
  console.log('='.repeat(60))

  // Verifikasi koneksi
  try {
    await src.query('SELECT 1')
    console.log('✓ Koneksi Neon OK')
  } catch (e) {
    console.error('✗ Gagal konek ke Neon:', e.message)
    process.exit(1)
  }
  try {
    await dst.query('SELECT 1')
    console.log('✓ Koneksi Prisma Postgres OK')
  } catch (e) {
    console.error('✗ Gagal konek ke Prisma Postgres:', e.message)
    process.exit(1)
  }

  console.log('')
  console.log('Memulai transfer tabel...')
  console.log('-'.repeat(60))

  let totalRows = 0
  let totalInserted = 0
  let totalSkipped  = 0
  const errors = []

  for (const table of TABLES) {
    try {
      const r = await migrateTable(src, dst, table)
      totalRows     += r.total
      totalInserted += r.inserted
      totalSkipped  += r.skipped
    } catch (e) {
      // Tabel mungkin belum ada di Prisma Postgres (akan dibuat oleh db:migrate)
      console.warn(`  ${table.padEnd(30)} — ⚠ error: ${e.message}`)
      errors.push({ table, error: e.message })
    }
  }

  console.log('-'.repeat(60))
  console.log(`Total baris sumber : ${totalRows}`)
  console.log(`Berhasil di-insert : ${totalInserted}`)
  console.log(`Di-skip (duplikat) : ${totalSkipped}`)

  if (errors.length > 0) {
    console.log('')
    console.log('⚠ Tabel yang gagal (mungkin belum ada schema):')
    for (const e of errors) {
      console.log(`  - ${e.table}: ${e.error}`)
    }
    console.log('')
    console.log('→ Jalankan "npm run db:migrate" lalu ulang script ini.')
  } else {
    console.log('')
    console.log('✅ Migrasi data selesai!')
  }

  await src.end()
  await dst.end()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
