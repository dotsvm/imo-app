CREATE TABLE "market_interest" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_leases" (
	"lane" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "volume24h" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_interest" ADD CONSTRAINT "market_interest_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Every public table: row level security on, no policies, and nothing granted
-- to Supabase's client roles. Later migrations end with SELECT hunch_lock_down().
CREATE OR REPLACE FUNCTION hunch_lock_down() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  END IF;
END
$$;
--> statement-breakpoint
SELECT hunch_lock_down();
