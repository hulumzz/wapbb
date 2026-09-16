import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../../.env') })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL harus berupa URL PostgreSQL',
  ),
  WEB_ORIGIN: z.string().default('http://localhost:5173').transform((value, ctx) => {
    const origins = value.split(',').map((item) => item.trim()).filter(Boolean)
    if (!origins.length || origins.some((origin) => {
      try {
        return new URL(origin).origin !== origin
      } catch {
        return true
      }
    })) {
      ctx.addIssue({ code: 'custom', message: 'WEB_ORIGIN harus berisi origin valid tanpa path' })
      return z.NEVER
    }
    return origins
  }),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_PASSWORD: z.string().min(8),
  AUTH_SECRET: z.string().min(24),
  INTERNAL_DISPATCH_SECRET: z.string().min(12),
  WA_SESSION_ENCRYPTION_KEY: z.string().min(32),
  DEFAULT_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  PROCESSING_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(15),
  RETRY_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  DEFAULT_BANNER_URL: z.string().url().refine(
    (value) => value.startsWith('https://'),
    'DEFAULT_BANNER_URL harus menggunakan HTTPS',
  ).default('https://i.ibb.co.com/fVFQc0HD/Chat-GPT-Image-16-Sep-2026-11-08-14-1-2.png'),
})

export const config = envSchema.parse(process.env)
