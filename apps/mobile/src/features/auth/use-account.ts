/**
 * Where someone is in the app: signed out, waiting on an invite (the beta's
 * gate), onboarding, or in. Decided by the saved session and /me.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MeDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";
import { loadSession, onSessionChange, type Session } from "~/lib/session";

export type Phase = "loading" | "signed-out" | "gated" | "onboarding" | "in";

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadSession().then((s) => live && setSession(s));
    const off = onSessionChange(setSession);
    return () => {
      live = false;
      off();
    };
  }, []);
  return session;
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api<MeDTO>("/me", { signal }),
    enabled,
  });
}

export function useAccount() {
  const session = useSession();
  const queryClient = useQueryClient();
  const me = useMe(!!session);

  // A different person (or nobody) now: nothing cached for the last one stays.
  const token = session?.accessToken ?? null;
  const [lastToken, setLastToken] = useState(token);
  if (token !== lastToken) {
    setLastToken(token);
    if (!token || !lastToken) queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "config" });
  }

  let phase: Phase;
  if (session === undefined) phase = "loading";
  else if (!session) phase = "signed-out";
  else if (me.isPending) phase = "loading";
  // /me failing for a live session (offline, server down) still lets them in;
  // screens show their own errors. A dead session was already dropped (401).
  else if (!me.data) phase = "in";
  else if (me.data.access.gated && !me.data.access.granted) phase = "gated";
  else if (!me.data.settings.onboarded) phase = "onboarding";
  else phase = "in";

  return { phase, session, me: me.data };
}
