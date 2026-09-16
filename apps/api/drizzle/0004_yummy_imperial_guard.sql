ALTER TABLE "campaigns" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_idempotency_key_uidx" ON "campaigns" USING btree ("idempotency_key");