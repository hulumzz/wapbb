import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

export async function acquireLease(name: string, owner: string, seconds = 90): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO messaging_leases (name, owner, expires_at)
    VALUES (${name}, ${owner}, NOW() + ${seconds} * INTERVAL '1 second')
    ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
    WHERE messaging_leases.expires_at <= NOW() OR messaging_leases.owner = EXCLUDED.owner
    RETURNING name
  `)
  return result.rows.length === 1
}

export async function releaseLease(name: string, owner: string): Promise<void> {
  await db.execute(sql`DELETE FROM messaging_leases WHERE name = ${name} AND owner = ${owner}`)
}
