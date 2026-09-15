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
    // `generate` dan `check` hanya membaca schema dan harus tetap bisa
    // dijalankan sebelum Neon tersedia. Runtime migrator memvalidasi URL asli.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost/placeholder',
  },
})
