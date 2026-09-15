CREATE TABLE "campaign_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"batch_size" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" IN ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "campaigns_batch_size_check" CHECK ("campaigns"."batch_size" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_phone_normalized_unique" UNIQUE("phone_normalized")
);
--> statement-breakpoint
CREATE TABLE "message_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"recipient" text NOT NULL,
	"rendered_message" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"processing_token" text,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_jobs_attempts_check" CHECK ("message_jobs"."attempts" >= 0 AND "message_jobs"."attempts" <= "message_jobs"."max_attempts"),
	CONSTRAINT "message_jobs_status_check" CHECK ("message_jobs"."status" IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT 'WhatsApp Utama' NOT NULL,
	"phone_number" text,
	"status" text DEFAULT 'DISCONNECTED' NOT NULL,
	"connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_accounts_status_check" CHECK ("whatsapp_accounts"."status" IN ('DISCONNECTED', 'CONNECTING', 'QR_READY', 'CONNECTED', 'NEEDS_REAUTH'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_auth" (
	"account_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_auth_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_auth" ADD CONSTRAINT "whatsapp_auth_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_contact_uidx" ON "campaign_recipients" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_created_idx" ON "campaigns" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contacts_active_opt_in_idx" ON "contacts" USING btree ("is_active","whatsapp_opt_in");--> statement-breakpoint
CREATE UNIQUE INDEX "message_jobs_campaign_contact_uidx" ON "message_jobs" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "message_jobs_dispatch_idx" ON "message_jobs" USING btree ("campaign_id","status","scheduled_at","created_at");--> statement-breakpoint
CREATE INDEX "message_jobs_status_idx" ON "message_jobs" USING btree ("status");