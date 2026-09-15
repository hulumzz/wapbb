import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../.env') })

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib diisi sebelum menjalankan perintah database')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
