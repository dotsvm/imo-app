ALTER TABLE "rooms" ADD COLUMN "color" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "topics" text[] DEFAULT '{}'::text[] NOT NULL;