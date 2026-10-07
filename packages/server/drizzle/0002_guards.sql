-- The ledger is append-only: balances are a cache of it, so history must
-- never change. Corrections are new, opposite entries.
CREATE OR REPLACE FUNCTION forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% refused)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ledger_append_only ON ledger_entries;
--> statement-breakpoint
CREATE TRIGGER ledger_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
--> statement-breakpoint
-- Row level security on every table, with no policies: clients using the
-- database's public API (Supabase anon/authenticated roles) can read nothing.
-- The server connects as the owner and goes through the API layer, which does
-- its own authorization.
DO $$
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
