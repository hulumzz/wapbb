CREATE TABLE "delivery_safety" (
	"account_id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"last_outbound_at" timestamp with time zone,
	"next_allowed_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"mode" text DEFAULT 'NEW' NOT NULL,
	"hold_reason" text,
	"minute_bucket" timestamp with time zone,
	"minute_count" integer DEFAULT 0 NOT NULL,
	"hour_bucket" timestamp with time zone,
	"hour_count" integer DEFAULT 0 NOT NULL,
	"day_bucket" timestamp with time zone,
	"day_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_safety_mode_check" CHECK ("delivery_safety"."mode" IN ('NEW', 'STANDARD', 'PAUSED_RISK', 'MANUAL_HOLD'))
);
