ALTER TABLE "waitlist" ADD COLUMN "edition" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "boost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "link_opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_edition" CHECK (edition in ('classic', 'macro', 'crypto', 'politics'));--> statement-breakpoint
SELECT hunch_lock_down();
