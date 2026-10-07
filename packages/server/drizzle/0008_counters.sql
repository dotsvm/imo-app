ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_kind";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "followers_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "following_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_kind" CHECK (kind in ('deposit', 'reset', 'buy', 'sell', 'venue_fee', 'app_fee', 'rounding_fee', 'reserve', 'release', 'settlement', 'adjustment'));--> statement-breakpoint
-- Counters start from the follows already recorded.
UPDATE "users" u SET
  "followers_count" = (SELECT count(*) FROM "follows" f WHERE f."followee_id" = u."id"),
  "following_count" = (SELECT count(*) FROM "follows" f WHERE f."follower_id" = u."id");
--> statement-breakpoint
SELECT hunch_lock_down();
