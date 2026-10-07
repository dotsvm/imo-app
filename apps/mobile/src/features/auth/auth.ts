/**
 * Signing in on the device. The API says which ways in are on (/config);
 * each ends in a token the API accepts as a bearer:
 *
 * - email: Supabase emails a 6-digit code, the app verifies it;
 * - Google and X (and Apple off iOS): Supabase's page in an in-app browser,
 *   back to the app with a one-time code (PKCE);
 * - Apple on iOS: the system sheet, its ID token checked by Supabase;
 * - dev: a local API's dev sign-in, any email in as its own paper account.
 */
import { createClient, type Session as SupabaseSession, type SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import type { ConfigDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";
import { saveSession, setRenewer, type Session } from "~/lib/session";

export type Provider = "apple" | "google" | "x";

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => api<ConfigDTO>("/config", { signal }),
    staleTime: 10 * 60 * 1000,
  });
}

// One client per Supabase project. Nothing persists through it: the session
// is ours (lib/session); its storage only holds a PKCE verifier mid-sign-in.
let client: { url: string; supabase: SupabaseClient } | undefined;
function supabaseFor(config: ConfigDTO): SupabaseClient {
  if (!config.supabase) throw new Error("Sign-in isn't set up on this server.");
  if (client?.url !== config.supabase.url) {
    const memory = new Map<string, string>();
    client = {
      url: config.supabase.url,
      supabase: createClient(config.supabase.url, config.supabase.publishableKey, {
        auth: {
          flowType: "pkce",
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: (k) => memory.get(k) ?? null,
            setItem: (k, v) => void memory.set(k, v),
            removeItem: (k) => void memory.delete(k),
          },
        },
      }),
    };
    const supabase = client.supabase;
    setRenewer(async (session) => {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: session.refreshToken });
      // A refresh that fails (revoked, expired) signs them out.
      return error || !data.session ? null : fromSupabase(data.session);
    });
  }
  return client.supabase;
}

const fromSupabase = (s: SupabaseSession): Session => ({
  kind: "supabase",
  accessToken: s.access_token,
  refreshToken: s.refresh_token,
  expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
});

/** Readies renewal for a session saved on an earlier launch. */
export function prepareAuth(config: ConfigDTO) {
  if (config.supabase) supabaseFor(config);
}

/** Sends the 6-digit code. Sign in only: an address with no account is refused. */
export async function sendEmailCode(config: ConfigDTO, email: string, mode: "signup" | "signin") {
  const { error } = await supabaseFor(config).auth.signInWithOtp({
    email,
    options: { shouldCreateUser: mode === "signup" },
  });
  if (error) throw new Error(friendly(error.message));
}

export async function verifyEmailCode(config: ConfigDTO, email: string, code: string) {
  const { data, error } = await supabaseFor(config).auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.session) throw new Error(error ? friendly(error.message) : "That code didn't work.");
  await saveSession(fromSupabase(data.session));
}

/** Local APIs only: no email goes out, the address signs straight in. */
export async function devSignIn(email: string) {
  const subject = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const { token } = await api<{ token: string }>("/dev/session", {
    body: { subject: subject.length >= 2 ? subject : `user-${subject}`, email },
  });
  await saveSession({ kind: "dev", accessToken: token });
}

/** Apple's own sheet is offered on iOS; everywhere else Apple goes through the browser. */
export const nativeApple = Platform.OS === "ios";

export async function signInWith(config: ConfigDTO, provider: Provider): Promise<"done" | "cancelled"> {
  const supabase = supabaseFor(config);

  if (provider === "apple" && nativeApple) {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("Apple didn't return a sign-in token.");
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken });
      if (error || !data.session) throw new Error(error?.message ?? "Apple sign-in didn't finish.");
      await saveSession(fromSupabase(data.session));
      return "done";
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_REQUEST_CANCELED") return "cancelled";
      throw error;
    }
  }

  const redirectTo = Linking.createURL("auth-callback");
  const { data, error } = await supabase.auth.signInWithOAuth({
    // Supabase's name for X differs per project ("x" or "twitter").
    provider: (provider === "x" ? config.auth.xProvider : provider) as "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error(error?.message ?? "Couldn't start sign-in.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return "cancelled";
  const back = Linking.parse(result.url).queryParams ?? {};
  if (typeof back.error === "string") {
    if (back.error === "access_denied") return "cancelled";
    throw new Error(typeof back.error_description === "string" ? back.error_description : "Sign-in didn't finish.");
  }
  if (typeof back.code !== "string") throw new Error("Sign-in didn't finish.");
  const exchanged = await supabase.auth.exchangeCodeForSession(back.code);
  if (exchanged.error || !exchanged.data.session) throw new Error(exchanged.error?.message ?? "Sign-in didn't finish.");
  await saveSession(fromSupabase(exchanged.data.session));
  return "done";
}

export async function signOut() {
  await api("/auth/sign-out", { method: "POST" }).catch(() => undefined);
  await saveSession(null);
}

function friendly(message: string) {
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired. Check it, or send a new one.";
  if (/signups not allowed|user not found/i.test(message)) return "No account with that email. Switch to Sign up.";
  if (/rate|security purposes/i.test(message)) return "Too many codes just now. Wait a minute and try again.";
  return message;
}
