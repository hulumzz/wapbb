import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

// Muat .env secara eksplisit (saat dijalankan via node dist/db/migrate.js)
const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../../.env') })

// Prisma Postgres: gunakan DIRECT_DATABASE_URL agar DDL tidak melewati pooler.
// Fallback ke DATABASE_URL untuk Neon / lokal.
const migrationUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
if (!migrationUrl) throw new Error('DATABASE_URL tidak tersedia di environment')

const migrationPool = new pg.Pool({ connectionString: migrationUrl, max: 1 })
const db = drizzle(migrationPool)

try {
  await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') })
  console.info('Migrasi database selesai')
} finally {
  await migrationPool.end()
}
