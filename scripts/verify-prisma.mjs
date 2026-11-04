// verify-prisma.mjs - verifikasi koneksi dan data di PostgreSQL (membaca dari .env)
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../.env') })

const require = createRequire(import.meta.url)
const pg = require('../node_modules/pg/lib/index.js')

const URL = process.env.DATABASE_URL
if (!URL) {
  console.error('DATABASE_URL tidak ditemukan di .env')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } })

const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)
console.log('Tabel di Prisma Postgres:')
tables.rows.forEach(r => console.log(' -', r.tablename))

const counts = await pool.query(`
  SELECT 'contacts'           AS t, COUNT(*)::int AS n FROM contacts
  UNION ALL SELECT 'campaigns',          COUNT(*)::int FROM campaigns
  UNION ALL SELECT 'message_jobs',       COUNT(*)::int FROM message_jobs
  UNION ALL SELECT 'campaign_recipients',COUNT(*)::int FROM campaign_recipients
  UNION ALL SELECT 'message_templates',  COUNT(*)::int FROM message_templates
  UNION ALL SELECT 'whatsapp_auth',      COUNT(*)::int FROM whatsapp_auth
  UNION ALL SELECT 'message_attempts',   COUNT(*)::int FROM message_attempts
  UNION ALL SELECT 'messaging_audit',    COUNT(*)::int FROM messaging_audit
`)
console.log('\nRow count:')
counts.rows.forEach(r => console.log(` - ${r.t.padEnd(25)} : ${r.n}`))

await pool.end()
console.log('\n✅ Koneksi Prisma Postgres OK')
