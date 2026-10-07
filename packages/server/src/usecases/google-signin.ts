/**
 * Google sign-in on our own domain, so Google's screen names us rather than
 * the identity provider. The start sends people to Google with a fresh
 * state, PKCE verifier and nonce, kept in a signed, short-lived cookie;
 * Google's return is checked against that cookie, its code traded for an ID
 * token, and the token handed to the identity provider for a session.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Deps } from "../composition";
import type { RequestCredentials } from "@imo/core/ports/identity";
import { safeNext } from "@imo/core/paths";
import { readToken, signToken, tokenSecret } from "../tokens";

export const GOOGLE_COOKIE = "imo_google";
const PURPOSE = "google-sign-in";
const TTL_MS = 10 * 60_000;
const COOKIE_PATH = "/api/v1/auth";

const random = () => randomBytes(32).toString("base64url");
const sha256 = (value: string, encoding: "base64url" | "hex") =>
  createHash("sha256").update(value).digest(encoding);

/** Where Google sends people back: an address on our own domain. */
export const googleReturn = (origin: string) => `${origin}/api/v1/auth/google`;

type GoogleDeps = Pick<Deps, "google" | "identity" | "config" | "profile" | "clock">;

/** Google's sign-in address for this browser, or null when Google sign-in
    isn't run by us here (then it goes through the identity provider). */
export function startGoogleSignIn(deps: GoogleDeps, origin: string, next: string, credentials: RequestCredentials) {
  if (!deps.google || !deps.identity.signInWithIdToken) return null;
  const state = random();
  const verifier = random();
  const nonce = random();
  const expires = new Date(deps.clock.now().getTime() + TTL_MS);
  credentials.setCookie?.(
    GOOGLE_COOKIE,
    signToken(tokenSecret(deps), PURPOSE, { state, verifier, nonce, next: safeNext(next) }, expires),
    { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: COOKIE_PATH, maxAge: TTL_MS / 1_000 },
  );
  return deps.google.authorizeUrl({
    redirectUri: googleReturn(origin),
    state,
    codeChallenge: sha256(verifier, "base64url"),
    // Google puts this in the ID token; the provider hashes the raw one to match.
    nonce: sha256(nonce, "hex"),
  });
}

export type GoogleReturn = { code?: string; state?: string; error?: string };
export type GoogleOutcome = { next: string; problem?: "cancelled" | "expired" | "failed"; error?: string };

/** Google came back: is it the sign-in this browser started? Then a session.
    Never throws: says where to go next, and what went wrong if anything. */
export async function finishGoogleSignIn(
  deps: GoogleDeps,
  origin: string,
  returned: GoogleReturn,
  credentials: RequestCredentials,
): Promise<GoogleOutcome> {
  const cookie = credentials.cookie(GOOGLE_COOKIE);
  // One try per start, whatever happens.
  credentials.setCookie?.(GOOGLE_COOKIE, "", { path: COOKIE_PATH, maxAge: 0 });
  const saved = cookie ? readToken(tokenSecret(deps), PURPOSE, cookie, deps.clock.now()) : null;
  const next = saved?.next ? safeNext(saved.next) : "/";
  if (returned.error) return { next, problem: returned.error === "access_denied" ? "cancelled" : "failed" };
  if (!saved || !returned.code || !returned.state || returned.state !== saved.state) return { next, problem: "expired" };
  if (!deps.google || !deps.identity.signInWithIdToken) return { next, problem: "failed" };
  try {
    const { idToken } = await deps.google.exchangeCode({
      code: returned.code,
      redirectUri: googleReturn(origin),
      codeVerifier: saved.verifier,
    });
    await deps.identity.signInWithIdToken("google", idToken, saved.nonce, credentials);
    return { next };
  } catch (error) {
    return { next, problem: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
