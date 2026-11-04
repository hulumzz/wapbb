import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../.env') })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Prisma Postgres: gunakan DIRECT_DATABASE_URL untuk DDL (migrasi).
    // Fallback ke DATABASE_URL untuk kompatibilitas Neon / lokal.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost/placeholder',
  },
})
