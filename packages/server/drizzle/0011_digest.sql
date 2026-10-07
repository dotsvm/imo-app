ALTER TABLE "user_settings" ADD COLUMN "last_digest_at" timestamp with time zone;--> statement-breakpoint
SELECT hunch_lock_down();
