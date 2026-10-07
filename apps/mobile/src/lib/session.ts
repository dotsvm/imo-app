/**
 * Who's signed in on this device, kept in the platform keychain
 * (SecureStore); on web, which has none, in memory for the tab.
 *
 * Two kinds: a Supabase session (access + refresh token, renewed before it
 * runs out) and, against a local API, a dev token. Screens subscribe to
 * changes; the API client asks for a fresh access token on every request.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type Session =
  | { kind: "supabase"; accessToken: string; refreshToken: string; expiresAt: number }
  | { kind: "dev"; accessToken: string };

const KEY = "imo.session";
let cached: Session | null | undefined;
const listeners = new Set<(session: Session | null) => void>();

export async function loadSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  const raw = Platform.OS === "web" ? null : await SecureStore.getItemAsync(KEY);
  try {
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveSession(session: Session | null): Promise<void> {
  cached = session;
  if (Platform.OS !== "web") {
    if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(KEY);
  }
  listeners.forEach((fn) => fn(session));
}

export function onSessionChange(fn: (session: Session | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Renews a Supabase session; installed by the auth module so this file
    stays free of provider code. */
let renew: ((session: Extract<Session, { kind: "supabase" }>) => Promise<Session | null>) | undefined;
export const setRenewer = (fn: typeof renew) => {
  renew = fn;
};

let renewing: Promise<Session | null> | undefined;

/** The token to send now: renewed first when it has under a minute left. */
export async function getAccessToken(): Promise<string | null> {
  const session = await loadSession();
  if (!session) return null;
  if (session.kind === "supabase" && session.expiresAt * 1000 - Date.now() < 60_000 && renew) {
    // One renewal at a time: a refresh token is single-use.
    renewing ??= renew(session)
      .then(async (next) => {
        await saveSession(next);
        return next;
      })
      .finally(() => {
        renewing = undefined;
      });
    return (await renewing)?.accessToken ?? null;
  }
  return session.accessToken;
}
