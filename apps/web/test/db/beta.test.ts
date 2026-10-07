import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { createWorker } from "@imo/server/worker";
import { GET as me } from "../../src/app/api/v1/me/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { GET as markets } from "../../src/app/api/v1/markets/route";
import { GET as myInvites, POST as newInvite } from "../../src/app/api/v1/invites/route";
import { POST as redeem } from "../../src/app/api/v1/invites/redeem/route";
import { POST as waitlist } from "../../src/app/api/v1/waitlist/route";
import { GET as notifications } from "../../src/app/api/v1/notifications/route";
import { GET as posts } from "../../src/app/api/v1/posts/route";
import { POST as orders } from "../../src/app/api/v1/orders/route";
import { POST as quotes } from "../../src/app/api/v1/quotes/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void };
const auth: Record<string, string> = {};
let worker: ReturnType<typeof createWorker>;

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "beta-tests" });
  // Signed up while the beta was open: already in.
  auth.member = await signIn("beta-member", "Mo Member");
  await call(me, "/api/v1/me", { auth: auth.member }); // first request provisions them
  // Then the gate closes (flags are cached for ten seconds).
  await deps().db.insert(t.flags).values({ key: "beta_gate", enabled: true });
  clock().advance(11_000);
  auth.newcomer = await signIn("beta-newcomer", "Nia Newcomer");
  auth.late = await signIn("beta-late", "Lou Late");
});
after(async () => deps().close());
beforeEach(() => clock().advance(30_000));

test("with the gate closed, everyone can read, but only people let in take part", async () => {
  const self = await call<{ access: { gated: boolean; granted: boolean } }>(me, "/api/v1/me", { auth: auth.newcomer });
  assert.equal(self.status, 200, "you can see where you stand");
  assert.deepEqual(self.body.access, { gated: true, granted: false });
  // Reading is open, signed in or not: the feed, markets, your own page.
  const feed = await call(posts, "/api/v1/posts?feed=latest&limit=5");
  assert.equal(feed.status, 200, "the feed is public");
  const prices = await call(markets, "/api/v1/markets?limit=2");
  assert.equal(prices.status, 200, "public market data stays open");
  const own = await call(portfolio, "/api/v1/portfolio", { auth: auth.newcomer });
  assert.equal(own.status, 200, "your own (untouched) account, readable");
  const anonymous = await call(portfolio, "/api/v1/portfolio");
  assert.equal(anonymous.status, 401, "yours needs you signed in");
  // Taking part needs access.
  const blocked = await call<{ error: { code: string } }>(orders, "/api/v1/orders", {
    auth: auth.newcomer,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: "gate-check-1" },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "beta_access_required");
  const priced = await call(quotes, "/api/v1/quotes", {
    auth: auth.newcomer,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 1_000 },
  });
  assert.equal(priced.status, 200, "pricing a ticket is a read");
  const member = await call(orders, "/api/v1/orders", {
    auth: auth.member,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: "gate-check-2" },
  });
  assert.equal(member.status, 201, "members who joined while it was open are in");
});

test("the waitlist takes an email and says nothing about who's on it", async () => {
  const first = await call<{ joined: boolean }>(waitlist, "/api/v1/waitlist", { body: { email: "Someone@Example.com", note: "Macro trader" } });
  const again = await call<{ joined: boolean }>(waitlist, "/api/v1/waitlist", { body: { email: "someone@example.com" } });
  assert.deepEqual([first.status, again.status, again.body.joined], [202, 202, true]);
  const rows = await deps().db.select().from(t.waitlist);
  assert.deepEqual(rows.map((r) => r.email), ["someone@example.com"]);
});

test("a member's invite lets one person in, once", async () => {
  const created = await call<{ code: string; maxUses: number }>(newInvite, "/api/v1/invites", { auth: auth.member, method: "POST" });
  assert.equal(created.status, 201);
  assert.match(created.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  const typed = created.body.code.toLowerCase().replace("-", " ");
  const used = await call<{ granted: boolean; already: boolean }>(redeem, "/api/v1/invites/redeem", { auth: auth.newcomer, body: { code: typed } });
  assert.deepEqual([used.status, used.body.granted, used.body.already], [200, true, false]);
  assert.equal((await call(portfolio, "/api/v1/portfolio", { auth: auth.newcomer })).status, 200);
  const twice = await call<{ already: boolean }>(redeem, "/api/v1/invites/redeem", { auth: auth.newcomer, body: { code: created.body.code } });
  assert.equal(twice.body.already, true, "already in: the code isn't spent again");

  const late = await call<{ error: { code: string } }>(redeem, "/api/v1/invites/redeem", { auth: auth.late, body: { code: created.body.code } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, "invite_used");
  const bogus = await call(redeem, "/api/v1/invites/redeem", { auth: auth.late, body: { code: "ZZZZ-ZZZZ" } });
  assert.equal(bogus.status, 404);

  for (let i = 0; i < 2; i++) await call(newInvite, "/api/v1/invites", { auth: auth.member, method: "POST" });
  const over = await call(newInvite, "/api/v1/invites", { auth: auth.member, method: "POST" });
  assert.equal(over.status, 422, "three each");
  const mine = await call<{ items: { uses: number }[]; remaining: number }>(myInvites, "/api/v1/invites", { auth: auth.member });
  assert.deepEqual([mine.body.items.length, mine.body.remaining], [3, 0]);

  for (let i = 0; i < 4; i++) if (!((await worker.run("outbox")) as { seen: number }).seen) break;
  const inbox = await call<{ items: { title: string }[] }>(notifications, "/api/v1/notifications", { auth: auth.member });
  assert.ok(inbox.body.items.some((n) => n.title === "Nia Newcomer joined imo with your invite"));
});

test("an expired or revoked code doesn't open the door", async () => {
  await deps().db.insert(t.invites).values([
    { code: "EXPD-2222", maxUses: 5, expiresAt: new Date("2026-01-01T00:00:00Z") },
    { code: "RVKD-3333", maxUses: 5, revokedAt: new Date("2026-09-01T00:00:00Z") },
  ]);
  const expired = await call<{ error: { code: string } }>(redeem, "/api/v1/invites/redeem", { auth: auth.late, body: { code: "EXPD-2222" } });
  assert.equal(expired.body.error.code, "invite_expired");
  const revoked = await call(redeem, "/api/v1/invites/redeem", { auth: auth.late, body: { code: "RVKD-3333" } });
  assert.equal(revoked.status, 404);
  const [late] = await deps().db.select({ at: t.users.accessGrantedAt }).from(t.users).where(eq(t.users.displayName, "Lou Late"));
  assert.equal(late.at, null);
});
