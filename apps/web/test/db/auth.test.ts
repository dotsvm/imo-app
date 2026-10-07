import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { MemoryStorage } from "@imo/server/adapters/memory/platform";
import { defaultAvatar } from "@imo/core/avatars";
import type { IdentityProvider } from "@imo/core/ports/identity";
import { getServerDeps, ready } from "@imo/server/deps";
import { GET as callback } from "../../src/app/api/v1/auth/callback/route";
import { POST as signOut } from "../../src/app/api/v1/auth/sign-out/route";
import { GET as me } from "../../src/app/api/v1/me/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const identity = () => deps().identity as IdentityProvider;
const noParams = { params: Promise.resolve({}) };
let ip = 0;
const request = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { "x-forwarded-for": `10.77.${ip++ % 250}.1`, ...init.headers },
  });

before(async () => {
  await resetDatabase(deps().db);
  await ready();
});
after(async () => deps().close());
beforeEach(() => (deps().clock as unknown as { advance(ms: number): void }).advance(30_000));

test("a cancelled Google sign-in comes back to where it started", async () => {
  const res = await callback(
    request("/api/v1/auth/callback?error=access_denied&error_description=User+cancelled&next=%2Fmarket%2Ffed-dec%3Ftab%3Dbook"),
    noParams,
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/market/fed-dec?tab=book&signin=cancelled");
});

test("a code no provider recognizes fails back — and never off-site", async () => {
  const res = await callback(request("/api/v1/auth/callback?code=abc&next=%2F%2Fevil.example"), noParams);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/?signin=failed");
});

test("a finished sign-in sets the session cookie and goes on; a spent one says so", async () => {
  const original = identity().completeSignIn;
  identity().completeSignIn = async (returned, credentials) => {
    if (returned.code !== "good") throw new Error("invalid flow state");
    credentials.setCookie?.("sb-test-auth-token", "session", { path: "/", sameSite: "lax" });
    return true;
  };
  try {
    const ok = await callback(request("/api/v1/auth/callback?code=good&next=%2Fmarket%2Ffed-dec"), noParams);
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get("location"), "/market/fed-dec");
    assert.match(ok.headers.get("set-cookie") ?? "", /sb-test-auth-token=session/);

    const spent = await callback(request("/api/v1/auth/callback?code=used&next=%2Ffeed"), noParams);
    assert.equal(spent.headers.get("location"), "/feed?signin=expired");
    assert.doesNotMatch(spent.headers.get("set-cookie") ?? "", /sb-test-auth-token/);
  } finally {
    identity().completeSignIn = original;
  }
});

test("a refreshed session survives an error answer", async () => {
  const original = identity().resolve;
  identity().resolve = async (credentials) => {
    // The provider refreshed the session, then the request failed anyway.
    credentials.setCookie?.("sb-test-auth-token", "refreshed", { path: "/" });
    return null;
  };
  try {
    const res = await me(request("/api/v1/me"), noParams);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("set-cookie") ?? "", /sb-test-auth-token=refreshed/);
  } finally {
    identity().resolve = original;
  }
});

test("signing out clears the session, and only from our own pages", async () => {
  const bearer = await signIn("auth-leaver", "Lee Leaver");
  const cookie = `hunch_dev_session=${bearer.replace(/^Bearer dev\./, "")}`;

  const forged = await signOut(
    request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin: "https://evil.example" } }),
    noParams,
  );
  assert.equal(forged.status, 403);

  const res = await signOut(
    request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie, origin: "http://localhost", host: "localhost" } }),
    noParams,
  );
  assert.equal(res.status, 200);
  const cleared = res.headers.get("set-cookie") ?? "";
  assert.match(cleared, /hunch_dev_session=;/);
  assert.match(cleared, /Max-Age=0/i);
});

test("/me says how you signed in and whether the address is confirmed", async () => {
  const auth = await signIn("auth-method", "Mae Method", "mae@example.com");
  const res = await call<{ signIn: { method: string | null }; settings: { email: string; emailVerified: boolean } }>(
    me,
    "/api/v1/me",
    { auth },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.signIn.method, "dev");
  assert.equal(res.body.settings.email, "mae@example.com");
  assert.equal(res.body.settings.emailVerified, true);
});

test("an avatar must be yours, uploaded, and an image", async () => {
  const { POST: upload } = await import("../../src/app/api/v1/uploads/route");
  const { PATCH: patchMe } = await import("../../src/app/api/v1/me/route");
  const storage = deps().storage as MemoryStorage;
  const ada = await signIn("auth-avatar-ada", "Ada Avatar");
  const bo = await signIn("auth-avatar-bo", "Bo Avatar");
  const ticket = await call<{ key: string; publicUrl: string }>(upload, "/api/v1/uploads", {
    auth: ada,
    body: { purpose: "avatar", contentType: "image/png", bytes: 40_000 },
  });
  assert.equal(ticket.status, 201);

  const early = await call(patchMe, "/api/v1/me", { method: "PATCH", auth: ada, body: { avatarKey: ticket.body.key } });
  assert.equal(early.status, 422, "not uploaded yet");

  storage.put(ticket.body.key, "image/png", 40_000);
  const stolen = await call(patchMe, "/api/v1/me", { method: "PATCH", auth: bo, body: { avatarKey: ticket.body.key } });
  assert.equal(stolen.status, 403, "someone else's upload");

  const saved = await call<{ user: { avatarUrl: string | null } }>(patchMe, "/api/v1/me", {
    method: "PATCH",
    auth: ada,
    body: { avatarKey: ticket.body.key },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.user.avatarUrl, ticket.body.publicUrl);

  // Some stores don't hold an upload to its ticket's type: what arrived counts.
  const swap = await call<{ key: string }>(upload, "/api/v1/uploads", {
    auth: ada,
    body: { purpose: "avatar", contentType: "image/png", bytes: 1_000 },
  });
  storage.objects.set(swap.body.key, { contentType: "text/html", bytes: 1_000 });
  const html = await call(patchMe, "/api/v1/me", { method: "PATCH", auth: ada, body: { avatarKey: swap.body.key } });
  assert.equal(html.status, 422);

  const removed = await call<{ user: { id: string; avatarUrl: string } }>(patchMe, "/api/v1/me", {
    method: "PATCH",
    auth: ada,
    body: { avatarKey: null },
  });
  assert.equal(removed.body.user.avatarUrl, defaultAvatar(removed.body.user.id), "back to her illustration");
  // The removed photo leaves storage too, once the worker gets to it.
  assert.ok(storage.objects.has(ticket.body.key));
  const { createWorker } = await import("@imo/server/worker");
  await createWorker(deps() as Parameters<typeof createWorker>[0], { holder: "auth-tests" }).run("jobs");
  assert.equal(storage.objects.has(ticket.body.key), false, "deleted from storage");
});

test("everyone wears an illustration until they choose one, or a photo", async () => {
  const { POST: upload } = await import("../../src/app/api/v1/uploads/route");
  const { PATCH: patchMe } = await import("../../src/app/api/v1/me/route");
  const { GET: trader } = await import("../../src/app/api/v1/traders/[handle]/route");
  const storage = deps().storage as MemoryStorage;
  type Me = { user: { id: string; handle: string; avatarUrl: string } };
  const cy = await signIn("auth-avatar-cy", "Cy Preset");
  const fresh = await call<Me>(me, "/api/v1/me", { auth: cy });
  const given = defaultAvatar(fresh.body.user.id);
  assert.equal(fresh.body.user.avatarUrl, given, "one of ours from the start");
  const { handle } = fresh.body.user;
  const seen = await call<{ avatarUrl: string }>(trader, `/api/v1/traders/${handle}`, { params: { handle } });
  assert.equal(seen.body.avatarUrl, given, "the same face to everyone else");

  const picked = await call<Me>(patchMe, "/api/v1/me", { method: "PATCH", auth: cy, body: { avatarPreset: "lorelei-07" } });
  assert.equal(picked.status, 200);
  assert.equal(picked.body.user.avatarUrl, "/avatars/lorelei-07.svg");
  const unknown = await call(patchMe, "/api/v1/me", { method: "PATCH", auth: cy, body: { avatarPreset: "lorelei-99" } });
  assert.equal(unknown.status, 400, "only the illustrations we draw");

  // A photo, then an illustration again: the photo leaves storage.
  const ticket = await call<{ key: string; publicUrl: string }>(upload, "/api/v1/uploads", {
    auth: cy,
    body: { purpose: "avatar", contentType: "image/png", bytes: 20_000 },
  });
  storage.put(ticket.body.key, "image/png", 20_000);
  const photo = await call<Me>(patchMe, "/api/v1/me", { method: "PATCH", auth: cy, body: { avatarKey: ticket.body.key } });
  assert.equal(photo.body.user.avatarUrl, ticket.body.publicUrl);
  const both = await call(patchMe, "/api/v1/me", {
    method: "PATCH",
    auth: cy,
    body: { avatarKey: ticket.body.key, avatarPreset: "lorelei-02" },
  });
  assert.equal(both.status, 422, "a photo or an illustration, not both");
  const back = await call<Me>(patchMe, "/api/v1/me", { method: "PATCH", auth: cy, body: { avatarPreset: "lorelei-02" } });
  assert.equal(back.body.user.avatarUrl, "/avatars/lorelei-02.svg");
  const { createWorker } = await import("@imo/server/worker");
  await createWorker(deps() as Parameters<typeof createWorker>[0], { holder: "auth-tests" }).run("jobs");
  assert.equal(storage.objects.has(ticket.body.key), false, "the photo it replaced is deleted");
});

test("wallets that never arrived are asked for again when you come back", async () => {
  const { sql: raw } = await import("drizzle-orm");
  const auth = await signIn("auth-wallets-lost", "Wally Lost");
  await call(me, "/api/v1/me", { auth }); // provisioned, with the test profile's wallets
  // A provider outage outlasted every retry: no wallets on record.
  await deps().db.execute(raw`delete from wallets where user_id = (select user_id from auth_identities where subject = 'auth-wallets-lost')`);
  await deps().db.execute(raw`delete from jobs where name = 'wallets.provision'`);

  await call(me, "/api/v1/me", { auth });
  const queued = await deps().db.execute<{ n: number }>(raw`select count(*)::int as n from jobs where name = 'wallets.provision' and status = 'pending'`);
  assert.equal(queued[0]!.n, 1, "asked for again");
  await call(me, "/api/v1/me", { auth });
  const again = await deps().db.execute<{ n: number }>(raw`select count(*)::int as n from jobs where name = 'wallets.provision'`);
  assert.equal(again[0]!.n, 1, "once, however often they come back");

  const { createWorker } = await import("@imo/server/worker");
  const worker = createWorker(deps() as Parameters<typeof createWorker>[0], { holder: "auth-wallets" });
  await worker.run("jobs");
  const early = await call<{ wallets: { custody: string }[] }>(me, "/api/v1/me", { auth });
  assert.equal(early.body.wallets.length, 0, "not at once: a first sign-in may still be making them");
  (deps().clock as unknown as { advance(ms: number): void }).advance(31_000);
  await worker.run("jobs");
  const after = await call<{ wallets: { custody: string }[] }>(me, "/api/v1/me", { auth });
  assert.ok(after.body.wallets.some((w) => w.custody === "embedded"), "wallets back");
});
