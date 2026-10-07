/**
 * Signed, expiring tokens for links we mail (email verification): the
 * payload travels in the link, and an HMAC proves we issued it. Nothing to
 * store, nothing to clean up.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEV_SECRET, type Deps } from "./composition";

export function tokenSecret(deps: Pick<Deps, "config" | "profile">) {
  const secret = deps.config.SESSION_SECRET;
  if (secret) return secret;
  if (deps.profile === "production" || deps.profile === "staging")
    throw new Error("SESSION_SECRET is required to sign links.");
  return DEV_SECRET;
}

const b64 = (text: string) => Buffer.from(text).toString("base64url");
const sign = (secret: string, purpose: string, body: string) =>
  createHmac("sha256", secret).update(`${purpose}.${body}`).digest("base64url");

export function signToken(
  secret: string,
  purpose: string,
  payload: Record<string, string>,
  expiresAt: Date,
) {
  const body = b64(JSON.stringify({ ...payload, exp: expiresAt.getTime() }));
  return `${body}.${sign(secret, purpose, body)}`;
}

/** The payload, or null when forged, for another purpose, or expired. */
export function readToken(
  secret: string,
  purpose: string,
  token: string,
  now: Date,
): Record<string, string> | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(secret, purpose, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const { exp, ...payload } = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Record<string, string> & { exp: number };
    return exp > now.getTime() ? payload : null;
  } catch {
    return null;
  }
}
