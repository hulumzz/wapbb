import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client.js'

try {
  const here = dirname(fileURLToPath(import.meta.url))
  await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') })
  console.info('Migrasi database selesai')
} finally {
  await pool.end()
}
