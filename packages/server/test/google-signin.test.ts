import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GoogleOAuth } from "../src/adapters/identity/google";
import { SupabaseIdentity } from "../src/adapters/identity/supabase";
import type { RequestCredentials } from "@imo/core/ports/identity";
import { finishGoogleSignIn, GOOGLE_COOKIE, startGoogleSignIn } from "../src/usecases/google-signin";

const sha256 = (value: string, encoding: "base64url" | "hex") => createHash("sha256").update(value).digest(encoding);

/** A request carrying `cookies`, recording what gets written back. */
function credentials(cookies: Record<string, string> = {}) {
  const written: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  const creds: RequestCredentials = {
    headers: new Headers(header ? { cookie: header } : {}),
    cookie: (name) => cookies[name],
    setCookie: (name, value, options) => written.push({ name, value, options }),
  };
  return { creds, written };
}

describe("Google's OAuth endpoints", () => {
  it("asks for sign-in with PKCE and a nonce, returning to our address", () => {
    const url = new URL(
      new GoogleOAuth("client-1", "secret-1").authorizeUrl({
        redirectUri: "https://www.tryimo.xyz/api/v1/auth/google",
        state: "state-1",
        codeChallenge: "challenge-1",
        nonce: "nonce-hash-1",
      }),
    );
    assert.equal(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      client_id: "client-1",
      redirect_uri: "https://www.tryimo.xyz/api/v1/auth/google",
      response_type: "code",
      scope: "openid email profile",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
      nonce: "nonce-hash-1",
    });
  });

  it("trades the code and verifier for Google's ID token", async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = new URLSearchParams(String(init?.body));
      return Response.json({ id_token: "id-token-1", access_token: "a" });
    }) as typeof fetch;
    const got = await new GoogleOAuth("client-1", "secret-1", fetchImpl).exchangeCode({
      code: "code-1",
      redirectUri: "https://w.example/api/v1/auth/google",
      codeVerifier: "verifier-1",
    });
    assert.deepEqual(got, { idToken: "id-token-1" });
    assert.equal(sent?.get("code_verifier"), "verifier-1");
    assert.equal(sent?.get("client_secret"), "secret-1");
    assert.equal(sent?.get("grant_type"), "authorization_code");
    assert.equal(sent?.get("redirect_uri"), "https://w.example/api/v1/auth/google");
  });

  it("says what Google refused", async () => {
    const fetchImpl = (async () => Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 })) as typeof fetch;
    await assert.rejects(
      new GoogleOAuth("c", "s", fetchImpl).exchangeCode({ code: "x", redirectUri: "https://w.example/cb", codeVerifier: "v" }),
      /Bad Request/,
    );
  });
});

describe("Supabase, from Google's ID token", () => {
  it("starts a session and writes it as cookies", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return Response.json({
        access_token: "header.payload.signature",
        token_type: "bearer",
        expires_in: 3_600,
        expires_at: Math.floor(Date.now() / 1000) + 3_600,
        refresh_token: "refresh-1",
        user: { id: "u1", aud: "authenticated", role: "authenticated", email: "ada@example.com", app_metadata: { provider: "google" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" },
      });
    }) as typeof fetch;
    const { creds, written } = credentials();
    await new SupabaseIdentity("https://abcd.supabase.co", "sb_publishable_test", fetchImpl).signInWithIdToken(
      "google",
      "id-token-1",
      "raw-nonce-1",
      creds,
    );
    const call = calls.find((c) => c.url.includes("grant_type=id_token"));
    assert.ok(call, "posts the ID token to Supabase");
    assert.equal(call.body.provider, "google");
    assert.equal(call.body.id_token, "id-token-1");
    assert.equal(call.body.nonce, "raw-nonce-1");
    assert.ok(written.some((c) => /^sb-abcd-auth-token(\.0)?$/.test(c.name) && c.value), "the session is a cookie");
  });
});

describe("Google sign-in on our own domain", () => {
  const ORIGIN = "https://www.tryimo.xyz";
  function world(at = Date.parse("2026-10-05T12:00:00Z")) {
    const seen: { authorize?: Record<string, string>; exchange?: Record<string, string>; session?: unknown[] } = {};
    const clock = { now: () => new Date(at) };
    const deps = {
      config: { SESSION_SECRET: "test-secret-for-google-sign-in-0000000000" },
      profile: "test",
      clock,
      google: {
        authorizeUrl: (input: Record<string, string>) => {
          seen.authorize = input;
          return "https://accounts.google.com/o/oauth2/v2/auth?…";
        },
        exchangeCode: async (input: Record<string, string>) => {
          seen.exchange = input;
          return { idToken: "id-token-1" };
        },
      },
      identity: {
        signInWithIdToken: async (...args: unknown[]) => {
          seen.session = args;
        },
      },
    } as unknown as Parameters<typeof startGoogleSignIn>[0];
    return { deps, seen, clock };
  }
  const start = (deps: Parameters<typeof startGoogleSignIn>[0], next = "/?claim=ada") => {
    const { creds, written } = credentials();
    const url = startGoogleSignIn(deps, ORIGIN, next, creds);
    const cookie = written.find((c) => c.name === GOOGLE_COOKIE);
    return { url, cookie };
  };

  it("sends Google back to us, with the sign-in's secrets in a signed, short-lived cookie", () => {
    const { deps, seen } = world();
    const { url, cookie } = start(deps);
    assert.ok(url);
    assert.equal(seen.authorize?.redirectUri, `${ORIGIN}/api/v1/auth/google`);
    assert.ok(cookie?.value);
    assert.equal(cookie?.options.httpOnly, true);
    assert.equal(cookie?.options.secure, true);
    assert.equal(cookie?.options.maxAge, 600);
  });

  it("goes through: the verifier answers the challenge and the nonce matches what Google signed", async () => {
    const { deps, seen } = world();
    const { cookie } = start(deps);
    const back = credentials({ [GOOGLE_COOKIE]: cookie!.value });
    const done = await finishGoogleSignIn(deps, ORIGIN, { code: "code-1", state: seen.authorize!.state }, back.creds);
    assert.deepEqual(done, { next: "/?claim=ada" });
    assert.equal(sha256(seen.exchange!.codeVerifier, "base64url"), seen.authorize!.codeChallenge);
    const [provider, idToken, nonce] = seen.session!;
    assert.deepEqual([provider, idToken], ["google", "id-token-1"]);
    assert.equal(sha256(String(nonce), "hex"), seen.authorize!.nonce);
    assert.ok(back.written.some((c) => c.name === GOOGLE_COOKIE && c.options.maxAge === 0), "the cookie is spent");
  });

  it("refuses a return it didn't start, a forged cookie, or one gone stale", async () => {
    const { deps, seen, clock } = world();
    const { cookie } = start(deps);
    const state = seen.authorize!.state;
    const finish = (returned: Record<string, string>, cookies: Record<string, string>) =>
      finishGoogleSignIn(deps, ORIGIN, returned, credentials(cookies).creds);
    assert.equal((await finish({ code: "c", state: "someone-elses" }, { [GOOGLE_COOKIE]: cookie!.value })).problem, "expired");
    assert.equal((await finish({ code: "c", state }, {})).problem, "expired", "no cookie: not this browser's");
    assert.equal((await finish({ code: "c", state }, { [GOOGLE_COOKIE]: `${cookie!.value}x` })).problem, "expired");
    clock.now = () => new Date(Date.parse("2026-10-05T12:11:00Z"));
    assert.equal((await finish({ code: "c", state }, { [GOOGLE_COOKIE]: cookie!.value })).problem, "expired", "ten minutes");
    assert.equal(seen.session, undefined, "no session for any of them");
  });

  it("reads Cancel at Google as cancelled, and a failed trade as failed", async () => {
    const { deps, seen } = world();
    const { cookie } = start(deps);
    const cancelled = await finishGoogleSignIn(deps, ORIGIN, { error: "access_denied" }, credentials({ [GOOGLE_COOKIE]: cookie!.value }).creds);
    assert.deepEqual(cancelled, { next: "/?claim=ada", problem: "cancelled" });
    const again = start(deps);
    (deps.google as unknown as { exchangeCode: () => Promise<never> }).exchangeCode = async () => {
      throw new Error("Google sign-in failed: Bad Request");
    };
    const failed = await finishGoogleSignIn(deps, ORIGIN, { code: "c", state: seen.authorize!.state }, credentials({ [GOOGLE_COOKIE]: again.cookie!.value }).creds);
    assert.equal(failed.problem, "failed");
    assert.match(failed.error ?? "", /Bad Request/);
  });

  it("leaves Google to the identity provider when its client isn't configured", () => {
    const { deps } = world();
    assert.equal(startGoogleSignIn({ ...deps, google: undefined }, ORIGIN, "/", credentials().creds), null);
  });
});
