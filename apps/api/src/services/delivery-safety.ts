import { randomInt } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { deliverySafety } from '../db/schema.js'

const ACCOUNT_ID = 'default'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const JAKARTA_OFFSET = 7 * HOUR
const WARMUP_DAILY_LIMITS = [10, 15, 25, 40, 60, 90, 120]
type SafetyTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function bucketStart(time: number, size: number, offset = 0) {
  return new Date(Math.floor((time + offset) / size) * size - offset)
}

function later(...dates: Array<Date | null | undefined>) {
  return dates.filter((date): date is Date => Boolean(date)).reduce<Date | null>((current, date) => !current || date > current ? date : current, null)
}

function warmupLimit(activatedAt: Date, now: Date) {
  const age = Math.max(0, Math.floor((bucketStart(now.getTime(), DAY, JAKARTA_OFFSET).getTime() - bucketStart(activatedAt.getTime(), DAY, JAKARTA_OFFSET).getTime()) / DAY))
  return { day: age + 1, limit: Math.min(config.WA_SAFETY_MAX_PER_DAY, WARMUP_DAILY_LIMITS[Math.min(age, WARMUP_DAILY_LIMITS.length - 1)]) }
}

export type SafetyDecision = { allowed: true; mode: string } | { allowed: false; reason: string; until?: Date; mode: string }

export async function reserveDelivery(tx: SafetyTx, phoneNumber: string, changedAt?: string, now = new Date()): Promise<SafetyDecision> {
  if (!config.WA_SAFETY_ENABLED) return { allowed: true, mode: 'DISABLED' }
  if (!phoneNumber) return { allowed: false, reason: 'NO_ACCOUNT', mode: 'NEW' }

  await tx.insert(deliverySafety).values({ accountId: ACCOUNT_ID, phoneNumber, activatedAt: now }).onConflictDoNothing()
  const [current] = await tx.select().from(deliverySafety).where(eq(deliverySafety.accountId, ACCOUNT_ID)).for('update')
  if (!current) throw new Error('Delivery safety state tidak tersedia')

  let profile = current
  if (profile.phoneNumber !== phoneNumber) {
    const [reset] = await tx.update(deliverySafety).set({
      phoneNumber, activatedAt: now, lastOutboundAt: null, nextAllowedAt: null,
      lastConnectedAt: null, cooldownUntil: null, mode: 'NEW', holdReason: null,
      minuteBucket: null, minuteCount: 0, hourBucket: null, hourCount: 0,
      dayBucket: null, dayCount: 0, updatedAt: now,
    }).where(eq(deliverySafety.accountId, ACCOUNT_ID)).returning()
    profile = reset
  } else if (profile.lastOutboundAt && now.getTime() - profile.lastOutboundAt.getTime() >= 72 * HOUR && !['PAUSED_RISK', 'MANUAL_HOLD'].includes(profile.mode)) {
    const [reset] = await tx.update(deliverySafety).set({ activatedAt: now, mode: 'NEW', updatedAt: now }).where(eq(deliverySafety.accountId, ACCOUNT_ID)).returning()
    profile = reset
  }

  const connectionTime = changedAt ? new Date(changedAt) : null
  if (connectionTime && Number.isFinite(connectionTime.getTime()) && (!profile.lastConnectedAt || connectionTime > profile.lastConnectedAt)) {
    const [updated] = await tx.update(deliverySafety).set({
      lastConnectedAt: connectionTime,
      cooldownUntil: new Date(Math.max(now.getTime(), connectionTime.getTime()) + config.WA_SAFETY_RECONNECT_COOLDOWN_SECONDS * 1000),
      updatedAt: now,
    }).where(eq(deliverySafety.accountId, ACCOUNT_ID)).returning()
    profile = updated
  }

  if (profile.mode === 'PAUSED_RISK' || profile.mode === 'MANUAL_HOLD') return { allowed: false, reason: profile.holdReason ?? profile.mode, mode: profile.mode }

  const warmup = warmupLimit(profile.activatedAt, now)
  const mode = warmup.day <= WARMUP_DAILY_LIMITS.length ? 'NEW' : 'STANDARD'
  const minute = bucketStart(now.getTime(), MINUTE)
  const hour = bucketStart(now.getTime(), HOUR)
  const day = bucketStart(now.getTime(), DAY, JAKARTA_OFFSET)
  const minuteCount = profile.minuteBucket?.getTime() === minute.getTime() ? profile.minuteCount : 0
  const hourCount = profile.hourBucket?.getTime() === hour.getTime() ? profile.hourCount : 0
  const dayCount = profile.dayBucket?.getTime() === day.getTime() ? profile.dayCount : 0

  const next = later(
    profile.nextAllowedAt && profile.nextAllowedAt > now ? profile.nextAllowedAt : null,
    profile.cooldownUntil && profile.cooldownUntil > now ? profile.cooldownUntil : null,
    minuteCount >= config.WA_SAFETY_MAX_PER_MINUTE ? new Date(minute.getTime() + MINUTE) : null,
    hourCount >= config.WA_SAFETY_MAX_PER_HOUR ? new Date(hour.getTime() + HOUR) : null,
    dayCount >= (mode === 'NEW' ? warmup.limit : config.WA_SAFETY_MAX_PER_DAY) ? new Date(day.getTime() + DAY) : null,
  )
  if (next) return { allowed: false, reason: 'PACING_OR_QUOTA', until: next, mode }

  const delaySeconds = randomInt(config.WA_SAFETY_MIN_DELAY_SECONDS, config.WA_SAFETY_MAX_DELAY_SECONDS + 1)
  await tx.update(deliverySafety).set({
    mode, lastOutboundAt: now, nextAllowedAt: new Date(now.getTime() + delaySeconds * 1000),
    minuteBucket: minute, minuteCount: minuteCount + 1,
    hourBucket: hour, hourCount: hourCount + 1,
    dayBucket: day, dayCount: dayCount + 1, updatedAt: now,
  }).where(eq(deliverySafety.accountId, ACCOUNT_ID))
  return { allowed: true, mode }
}

export async function pauseDeliveryForRisk(reason: string, phoneNumber?: string | null) {
  if (!config.WA_SAFETY_ENABLED) return
  if (phoneNumber) {
    await db.insert(deliverySafety).values({ accountId: ACCOUNT_ID, phoneNumber, activatedAt: new Date() }).onConflictDoNothing()
    const [current] = await db.select({ phoneNumber: deliverySafety.phoneNumber }).from(deliverySafety).where(eq(deliverySafety.accountId, ACCOUNT_ID)).limit(1)
    if (current?.phoneNumber !== phoneNumber) await db.update(deliverySafety).set({
      phoneNumber, activatedAt: new Date(), lastOutboundAt: null, nextAllowedAt: null,
      minuteBucket: null, minuteCount: 0, hourBucket: null, hourCount: 0, dayBucket: null, dayCount: 0,
    }).where(eq(deliverySafety.accountId, ACCOUNT_ID))
  }
  await db.update(deliverySafety).set({ mode: 'PAUSED_RISK', holdReason: reason, updatedAt: new Date() }).where(eq(deliverySafety.accountId, ACCOUNT_ID))
}

export async function isDeliveryHeld() {
  if (!config.WA_SAFETY_ENABLED) return false
  const [profile] = await db.select({ mode: deliverySafety.mode }).from(deliverySafety).where(eq(deliverySafety.accountId, ACCOUNT_ID)).limit(1)
  return profile?.mode === 'PAUSED_RISK' || profile?.mode === 'MANUAL_HOLD'
}

export async function resumeDelivery(phoneNumber: string) {
  if (!config.WA_SAFETY_ENABLED) return false
  const [profile] = await db.select().from(deliverySafety).where(and(eq(deliverySafety.accountId, ACCOUNT_ID), eq(deliverySafety.phoneNumber, phoneNumber))).limit(1)
  if (!profile || profile.mode !== 'PAUSED_RISK') return false
  const mode = warmupLimit(profile.activatedAt, new Date()).day <= WARMUP_DAILY_LIMITS.length ? 'NEW' : 'STANDARD'
  await db.update(deliverySafety).set({ mode, holdReason: null, cooldownUntil: new Date(Date.now() + config.WA_SAFETY_RECONNECT_COOLDOWN_SECONDS * 1000), updatedAt: new Date() }).where(and(eq(deliverySafety.accountId, ACCOUNT_ID), eq(deliverySafety.mode, 'PAUSED_RISK')))
  return true
}

export async function getDeliverySafetyStatus(phoneNumber: string | null) {
  const [profile] = await db.select().from(deliverySafety).where(eq(deliverySafety.accountId, ACCOUNT_ID)).limit(1)
  const current = profile?.phoneNumber === phoneNumber ? profile : null
  const now = new Date()
  const minute = bucketStart(now.getTime(), MINUTE)
  const hour = bucketStart(now.getTime(), HOUR)
  const day = bucketStart(now.getTime(), DAY, JAKARTA_OFFSET)
  const warmup = current ? warmupLimit(current.activatedAt, now) : { day: 1, limit: Math.min(config.WA_SAFETY_MAX_PER_DAY, WARMUP_DAILY_LIMITS[0]) }
  const mode = current?.mode === 'PAUSED_RISK' || current?.mode === 'MANUAL_HOLD' ? current.mode : warmup.day <= WARMUP_DAILY_LIMITS.length ? 'NEW' : 'STANDARD'
  const dayLimit = warmup.day <= WARMUP_DAILY_LIMITS.length ? warmup.limit : config.WA_SAFETY_MAX_PER_DAY
  return {
    enabled: config.WA_SAFETY_ENABLED, mode: config.WA_SAFETY_ENABLED ? mode : 'DISABLED',
    phoneNumber, holdReason: current?.holdReason ?? null,
    warmupDay: warmup.day, dailyLimit: dayLimit,
    reservedToday: current?.dayBucket?.getTime() === day.getTime() ? current.dayCount : 0,
    reservedThisHour: current?.hourBucket?.getTime() === hour.getTime() ? current.hourCount : 0,
    reservedThisMinute: current?.minuteBucket?.getTime() === minute.getTime() ? current.minuteCount : 0,
    nextAllowedAt: later(current?.nextAllowedAt && current.nextAllowedAt > now ? current.nextAllowedAt : null, current?.cooldownUntil && current.cooldownUntil > now ? current.cooldownUntil : null)?.toISOString() ?? null,
    minDelaySeconds: config.WA_SAFETY_MIN_DELAY_SECONDS,
    maxDelaySeconds: config.WA_SAFETY_MAX_DELAY_SECONDS,
    maxPerMinute: config.WA_SAFETY_MAX_PER_MINUTE,
    maxPerHour: config.WA_SAFETY_MAX_PER_HOUR,
  }
}
