-- Extensions the schema relies on. On Supabase they live in the `extensions`
-- schema (on the search path); elsewhere in the default schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
END
$$;
