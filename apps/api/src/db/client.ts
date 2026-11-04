import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { config } from '../config.js'
import * as schema from './schema.js'

const { Pool } = pg
const databaseUrl = new URL(config.DATABASE_URL)
// Upgrade sslmode ke verify-full hanya untuk prefer/verify-ca.
// 'require' dibiarkan apa adanya — kompatibel dengan Prisma Postgres & Neon.
const _sslmode = databaseUrl.searchParams.get('sslmode') ?? ''
if (['prefer', 'verify-ca'].includes(_sslmode)) {
  databaseUrl.searchParams.set('sslmode', 'verify-full')
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  max: 5,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 20_000,
  allowExitOnIdle: true,
  application_name: 'wapbb-api',
  statement_timeout: 5000,
  query_timeout: 6000,
})

export const db = drizzle(pool, { schema })
