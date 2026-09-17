CREATE TABLE "message_attempts" (
	"provider_message_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"generation" integer NOT NULL,
	"outbound_ciphertext" text,
	"delivery_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"object_id" text,
	"result" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "content_snapshot" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "banner_url" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_job_id_message_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."message_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_attempts_job_idx" ON "message_attempts" USING btree ("job_id");
--> statement-breakpoint
INSERT INTO "message_attempts" ("provider_message_id", "job_id", "generation", "delivery_status", "created_at", "updated_at")
SELECT "provider_message_id", "id", 0, "delivery_status", "created_at", "updated_at"
FROM "message_jobs" WHERE "provider_message_id" IS NOT NULL
ON CONFLICT DO NOTHING;
