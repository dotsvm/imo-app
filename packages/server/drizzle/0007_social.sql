ALTER TABLE "user_settings" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_members" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
SELECT hunch_lock_down();
