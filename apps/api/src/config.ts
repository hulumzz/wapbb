import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  INTERNAL_DISPATCH_SECRET: z.string().min(12),
  WA_SESSION_ENCRYPTION_KEY: z.string().min(16),
  DEFAULT_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(10),
})

export const config = envSchema.parse(process.env)
