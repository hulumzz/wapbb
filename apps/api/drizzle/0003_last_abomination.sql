ALTER TABLE "campaigns" ADD COLUMN "use_interactive_cta" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_label" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_footer" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "server_ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "cta_url" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "cta_label" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD COLUMN "cta_footer" text;--> statement-breakpoint
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_delivery_status_check" CHECK ("message_jobs"."delivery_status" IS NULL OR "message_jobs"."delivery_status" IN ('PENDING', 'SERVER_ACK', 'DELIVERED', 'READ', 'PLAYED', 'ERROR', 'UNKNOWN'));