import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SupabaseIdentity } from "../src/adapters/identity/supabase";
import { DevIdentity, DEV_SESSION_COOKIE } from "../src/adapters/identity/dev";
import { ManualClock } from "../src/adapters/memory/runtime";
import type { RequestCredentials } from "@imo/core/ports/identity";
import { routeParam, safeNext, withParam } from "@imo/core/paths";

describe("where sign-in sends you next", () => {
  it("keeps our own pages", () => {
    assert.equal(safeNext("/feed"), "/feed");
    assert.equal(safeNext("/market/fed-dec?tab=book#top"), "/market/fed-dec?tab=book#top");
  });
  it("refuses other sites, schemes, the API and odd characters", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/api/v1/me",
      "/feed\nSet-Cookie: x=1",
      "/ feed",
      "",
      undefined,
      null,
    ])
      assert.equal(safeNext(bad), "/", String(bad));
    assert.equal(safeNext("//evil.example", "/feed"), "/feed");
  });
  it("reads a route segment as the app named it", () => {
    assert.equal(routeParam("fed-dec%3Ayes"), "fed-dec:yes");
    assert.equal(routeParam("plain"), "plain");
    assert.equal(routeParam("100%"), "100%", "a stray % is kept, not thrown");
  });
  it("adds a parameter without losing the rest", () => {
    assert.equal(withParam("/welcome", "signin", "failed"), "/welcome?signin=failed");
    assert.equal(withParam("/welcome?next=%2Ffeed#x", "signin", "expired"), "/welcome?next=%2Ffeed&signin=expired#x");
  });
});

// ------------------------------------------------------------------ Supabase

const URL_ = "https://abcd.supabase.co";
const KEY = "sb_publishable_test";
const encode = (value: unknown) => `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;

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

const user = {
  id: "8c5b7a36-3f1e-4f5e-9a51-2d0f5b0f7a11",
  aud: "authenticated",
  role: "authenticated",
  email: "ada@example.com",
  app_metadata: { provider: "google" },
  user_metadata: { full_name: "Ada Lovelace" },
  created_at: "2026-09-01T00:00:00Z",
};
const session = (expiresAt = Math.floor(Date.now() / 1000) + 3_600) => ({
  access_token: "header.payload.signature",
  token_type: "bearer",
  expires_in: 3_600,
  expires_at: expiresAt,
  refresh_token: "refresh-1",
  user,
});

type Call = { url: string; method: string; body: Record<string, unknown> | null };
function supabaseApi(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Supabase sign-in, started on the server", () => {
  const verifier = (written: { name: string; value: string }[]) =>
    written.find((c) => c.name === "sb-abcd-auth-token-code-verifier");

  it("sends Google to Supabase's authorize page, with the verifier as a cookie", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json({}));
    const { creds, written } = credentials();
    const back = "https://wait.example/api/v1/auth/callback?next=%2F";
    const url = new URL(await new SupabaseIdentity(URL_, KEY, fetchImpl).startSignIn("google", back, creds));
    assert.equal(`${url.origin}${url.pathname}`, `${URL_}/auth/v1/authorize`);
    assert.equal(url.searchParams.get("provider"), "google");
    assert.equal(url.searchParams.get("redirect_to"), back);
    assert.ok(url.searchParams.get("code_challenge"), "PKCE");
    assert.equal(url.searchParams.get("apikey"), null, "no key in the address");
    assert.ok(verifier(written)?.value, "the verifier waits in a cookie for the callback");
    assert.equal(calls.length, 0, "nothing to ask Supabase yet");
  });

  it("uses the project's own name for X sign-in", async () => {
    const { fetchImpl } = supabaseApi((call) =>
      call.url.endsWith("/auth/v1/settings") ? json({ external: { twitter: true } }) : json({}),
    );
    const { creds } = credentials();
    const url = new URL(await new SupabaseIdentity(URL_, KEY, fetchImpl).startSignIn("x", "https://w.example/cb", creds));
    assert.equal(url.searchParams.get("provider"), "twitter");
  });

  it("emails a link that comes back to us, with the verifier as a cookie", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json({}));
    const { creds, written } = credentials();
    const back = "https://wait.example/api/v1/auth/callback?next=%2F";
    await new SupabaseIdentity(URL_, KEY, fetchImpl).sendSignInLink("ada@example.com", back, creds);
    const otp = calls.find((c) => c.url.includes("/auth/v1/otp"));
    assert.ok(otp, "asks Supabase to send the link");
    assert.equal(otp.body?.email, "ada@example.com");
    assert.equal(otp.body?.create_user, true);
    assert.ok(otp.body?.code_challenge, "PKCE");
    assert.match(otp.url, new RegExp(`redirect_to=${encodeURIComponent(back).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.ok(verifier(written)?.value, "the verifier waits in a cookie for the callback");
  });

  it("the callback trades the code with the very verifier the start left", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json(session()));
    const identity = new SupabaseIdentity(URL_, KEY, fetchImpl);
    const started = credentials();
    const url = new URL(await identity.startSignIn("google", "https://w.example/cb", started.creds));
    const left = verifier(started.written)!;
    const back = credentials({ [left.name]: left.value });
    assert.equal(await identity.completeSignIn({ code: "code-1" }, back.creds), true);
    const exchange = calls.find((c) => c.url.includes("grant_type=pkce"));
    const sent = String(exchange?.body?.code_verifier);
    assert.equal(
      createHash("sha256").update(sent).digest("base64url"),
      url.searchParams.get("code_challenge"),
      "the verifier answers the challenge Google was given",
    );
  });

  it("says when Supabase won't send the link", async () => {
    const { fetchImpl } = supabaseApi(() => json({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }, 429));
    const { creds } = credentials();
    await assert.rejects(
      new SupabaseIdentity(URL_, KEY, fetchImpl).sendSignInLink("ada@example.com", "https://w.example/cb", creds),
      (error: { status?: number }) => error.status === 429,
    );
  });
});

describe("Supabase sign-in", () => {
  it("does nothing without a code or token hash", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json({}));
    const { creds, written } = credentials();
    assert.equal(await new SupabaseIdentity(URL_, KEY, fetchImpl).completeSignIn({}, creds), false);
    assert.equal(calls.length, 0);
    assert.equal(written.length, 0);
  });

  it("trades Google's code and the PKCE verifier for session cookies", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json(session()));
    const { creds, written } = credentials({ "sb-abcd-auth-token-code-verifier": encode("verifier-123") });
    assert.equal(await new SupabaseIdentity(URL_, KEY, fetchImpl).completeSignIn({ code: "code-abc" }, creds), true);
    const exchange = calls.find((c) => c.url.includes("/auth/v1/token"));
    assert.ok(exchange, "posts to the token endpoint");
    assert.match(exchange.url, /grant_type=pkce/);
    assert.deepEqual(exchange.body, { auth_code: "code-abc", code_verifier: "verifier-123" });
    const saved = written.find((c) => c.name === "sb-abcd-auth-token" || c.name === "sb-abcd-auth-token.0");
    assert.ok(saved?.value, "the session is written as a cookie");
    const spent = written.find((c) => c.name === "sb-abcd-auth-token-code-verifier");
    assert.ok(spent && (spent.value === "" || spent.options.maxAge === 0), "the verifier is spent");
  });

  it("verifies an emailed link's token hash", async () => {
    const { calls, fetchImpl } = supabaseApi(() => json(session()));
    const { creds, written } = credentials();
    assert.equal(
      await new SupabaseIdentity(URL_, KEY, fetchImpl).completeSignIn({ tokenHash: "hash-1", type: "magiclink" }, creds),
      true,
    );
    const verify = calls.find((c) => c.url.includes("/auth/v1/verify"));
    assert.equal(verify?.body?.token_hash, "hash-1");
    assert.equal(verify?.body?.type, "magiclink");
    assert.ok(written.some((c) => c.name.startsWith("sb-abcd-auth-token") && c.value));
  });

  it("throws when the code is spent or expired", async () => {
    const { fetchImpl } = supabaseApi(() =>
      json({ code: "flow_state_not_found", msg: "invalid flow state, no valid flow state found" }, 404),
    );
    const { creds } = credentials({ "sb-abcd-auth-token-code-verifier": encode("verifier-123") });
    await assert.rejects(new SupabaseIdentity(URL_, KEY, fetchImpl).completeSignIn({ code: "old" }, creds));
  });

  it("signs out: revokes this device's session and clears its cookies", async () => {
    const { calls, fetchImpl } = supabaseApi(() => new Response(null, { status: 204 }));
    const { creds, written } = credentials({ "sb-abcd-auth-token": encode(session()) });
    await new SupabaseIdentity(URL_, KEY, fetchImpl).signOut(creds);
    const logout = calls.find((c) => c.url.includes("/auth/v1/logout"));
    assert.ok(logout, "revokes at Supabase");
    assert.match(logout.url, /scope=local/);
    assert.ok(written.some((c) => c.name === "sb-abcd-auth-token" && (c.value === "" || c.options.maxAge === 0)));
  });

  it("clears the cookies even when Supabase can't be reached", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { creds, written } = credentials({
      "sb-abcd-auth-token.0": encode(session()).slice(0, 40),
      "sb-abcd-auth-token.1": encode(session()).slice(40),
      unrelated: "keep",
    });
    await new SupabaseIdentity(URL_, KEY, fetchImpl).signOut(creds);
    const cleared = written.filter((c) => c.options.maxAge === 0).map((c) => c.name);
    assert.ok(cleared.includes("sb-abcd-auth-token.0") && cleared.includes("sb-abcd-auth-token.1"), cleared.join());
    assert.ok(!written.some((c) => c.name === "unrelated"));
  });
});

describe("Supabase's switched-on providers", () => {
  const settings = (external: Record<string, boolean>) => json({ external });
  it("offers only what the project has on", async () => {
    const { calls, fetchImpl } = supabaseApi(() => settings({ google: false, email: true, github: true }));
    const identity = new SupabaseIdentity(URL_, KEY, fetchImpl);
    assert.deepEqual(await identity.signInMethods(), { google: false, apple: false, x: false, email: true, ids: { x: "twitter" } });
    await identity.signInMethods();
    assert.equal(calls.length, 1, "asked once a minute, not per page");
    assert.match(calls[0]!.url, /\/auth\/v1\/settings$/);
  });
  it("reads wallet sign-in when the settings name it", async () => {
    const { fetchImpl } = supabaseApi(() => settings({ google: true, email: true, web3_solana: true }));
    assert.deepEqual(await new SupabaseIdentity(URL_, KEY, fetchImpl).signInMethods(), {
      google: true,
      apple: false,
      x: false,
      email: true,
      wallet: true,
      ids: { x: "twitter" },
    });
  });
  it("offers Apple and X when they're on, and names X the way the project does", async () => {
    const newer = supabaseApi(() => settings({ apple: true, x: true }));
    assert.deepEqual(await new SupabaseIdentity(URL_, KEY, newer.fetchImpl).signInMethods(), {
      google: false,
      apple: true,
      x: true,
      email: false,
      ids: { x: "x" },
    });
    const older = supabaseApi(() => settings({ twitter: true }));
    const methods = await new SupabaseIdentity(URL_, KEY, older.fetchImpl).signInMethods();
    assert.equal(methods.x, true);
    assert.equal(methods.ids?.x, "twitter");
  });
  it("rules nothing out when Supabase can't be reached", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    assert.deepEqual(await new SupabaseIdentity(URL_, KEY, fetchImpl).signInMethods(), {});
  });
});

describe("dev sign-out", () => {
  const dev = new DevIdentity("a-long-enough-dev-secret-for-these-tests-0000", new ManualClock());
  it("clears the dev session cookie", async () => {
    const { creds, written } = credentials({ [DEV_SESSION_COOKIE]: dev.issue("you") });
    await dev.signOut(creds);
    assert.deepEqual(
      written.map((c) => [c.name, c.value, c.options.maxAge]),
      [[DEV_SESSION_COOKIE, "", 0]],
    );
  });
  it("writes nothing when there's no dev session", async () => {
    const { creds, written } = credentials();
    await dev.signOut(creds);
    assert.equal(written.length, 0);
  });
});
