-- Who may listen to which realtime topic, for Supabase Realtime's private
-- channels. Market and post topics are public; a person hears their own
-- user topic and the rooms they belong to. Skipped where there's no Supabase
-- (plain Postgres serves realtime through LISTEN/NOTIFY and the SSE endpoint,
-- which authorizes in the API instead).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.hunch_can_listen(topic text)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
        SELECT CASE
          WHEN topic LIKE 'market:%' OR topic LIKE 'post:%' THEN true
          WHEN topic LIKE 'user:%' THEN EXISTS (
            SELECT 1 FROM auth_identities ai
            WHERE ai.provider = 'supabase'
              AND ai.subject = auth.uid()::text
              AND 'user:' || ai.user_id::text = topic)
          WHEN topic LIKE 'room:%' THEN EXISTS (
            SELECT 1 FROM auth_identities ai
            JOIN room_members rm ON rm.user_id = ai.user_id
            WHERE ai.provider = 'supabase'
              AND ai.subject = auth.uid()::text
              AND 'room:' || rm.room_id::text = topic)
          ELSE false
        END
      $body$
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.hunch_can_listen(text) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.hunch_can_listen(text) TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS hunch_listen ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY hunch_listen ON realtime.messages
      FOR SELECT TO authenticated
      USING (public.hunch_can_listen((SELECT realtime.topic())))
    $p$;
  END IF;
END
$$;
