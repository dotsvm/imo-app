CREATE TABLE "cache_entries" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cache_entries_expiry" ON "cache_entries" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "cache_entries" SET UNLOGGED;
--> statement-breakpoint
ALTER TABLE "rate_buckets" SET UNLOGGED;
--> statement-breakpoint
SELECT hunch_lock_down();
