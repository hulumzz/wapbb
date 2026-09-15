import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  phoneNormalized: text('phone_normalized').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  whatsappOptIn: boolean('whatsapp_opt_in').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('contacts_active_opt_in_idx').on(table.isActive, table.whatsappOptIn),
])

export const messageTemplates = pgTable('message_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  templateId: text('template_id').notNull().references(() => messageTemplates.id),
  status: text('status').notNull().default('DRAFT'),
  batchSize: integer('batch_size').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('campaigns_status_created_idx').on(table.status, table.createdAt),
  check('campaigns_status_check', sql`${table.status} IN ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED')`),
  check('campaigns_batch_size_check', sql`${table.batchSize} BETWEEN 1 AND 50`),
])

export const campaignRecipients = pgTable('campaign_recipients', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('campaign_recipients_campaign_contact_uidx').on(table.campaignId, table.contactId),
  index('campaign_recipients_campaign_idx').on(table.campaignId),
])

export const messageJobs = pgTable('message_jobs', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id),
  recipient: text('recipient').notNull(),
  renderedMessage: text('rendered_message').notNull(),
  status: text('status').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  processingAt: timestamp('processing_at', { withTimezone: true }),
  processingToken: text('processing_token'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  providerMessageId: text('provider_message_id'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('message_jobs_campaign_contact_uidx').on(table.campaignId, table.contactId),
  index('message_jobs_dispatch_idx').on(table.campaignId, table.status, table.scheduledAt, table.createdAt),
  index('message_jobs_status_idx').on(table.status),
  uniqueIndex('message_jobs_provider_message_uidx').on(table.providerMessageId),
  check('message_jobs_attempts_check', sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`),
  check('message_jobs_status_check', sql`${table.status} IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED')`),
])

export const whatsappAccounts = pgTable('whatsapp_accounts', {
  id: text('id').primaryKey(),
  label: text('label').notNull().default('WhatsApp Utama'),
  phoneNumber: text('phone_number'),
  status: text('status').notNull().default('DISCONNECTED'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('whatsapp_accounts_status_check', sql`${table.status} IN ('DISCONNECTED', 'CONNECTING', 'QR_READY', 'CONNECTED', 'NEEDS_REAUTH')`),
])

export const whatsappAuth = pgTable('whatsapp_auth', {
  accountId: text('account_id').notNull().references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.accountId, table.key] })])
