import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { createWorker } from "@imo/server/worker";
import { GET as me } from "../../src/app/api/v1/me/route";
import { GET as overview } from "../../src/app/api/v1/admin/overview/route";
import { PUT as setFlag } from "../../src/app/api/v1/admin/flags/[key]/route";
import { GET as invites, POST as issue } from "../../src/app/api/v1/admin/invites/route";
import { POST as revoke } from "../../src/app/api/v1/admin/invites/[code]/revoke/route";
import { POST as inviteWaitlist } from "../../src/app/api/v1/admin/waitlist/invite/route";
import { GET as people } from "../../src/app/api/v1/admin/people/route";
import { PATCH as person } from "../../src/app/api/v1/admin/people/[handle]/route";
import { PATCH as market } from "../../src/app/api/v1/admin/markets/[slug]/route";
import { PUT as mapping } from "../../src/app/api/v1/admin/category-map/route";
import { PATCH as venue } from "../../src/app/api/v1/admin/venues/[id]/route";
import { GET as queue } from "../../src/app/api/v1/admin/reports/route";
import { POST as resolve } from "../../src/app/api/v1/admin/reports/[id]/route";
import { GET as jobs } from "../../src/app/api/v1/admin/jobs/route";
import { POST as retry } from "../../src/app/api/v1/admin/jobs/[id]/retry/route";
import { GET as auditTrail } from "../../src/app/api/v1/admin/audit/route";
import { POST as report } from "../../src/app/api/v1/reports/route";
import { POST as waitlist } from "../../src/app/api/v1/waitlist/route";
import { POST as redeem } from "../../src/app/api/v1/invites/redeem/route";
import { POST as placeOrder } from "../../src/app/api/v1/orders/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { GET as markets } from "../../src/app/api/v1/markets/route";
import { GET as getPost } from "../../src/app/api/v1/posts/[id]/route";
import { POST as post } from "../../src/app/api/v1/posts/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void };
const mailer = () => deps().mailer as unknown as { sent: { template: string; to: string; data: Record<string, string> }[] };
const auth: Record<string, string> = {};
const handle: Record<string, string> = {};
let worker: ReturnType<typeof createWorker>;

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "admin-tests" });
  for (const [who, name] of [["boss", "Bea Boss"], ["ann", "Ann Author"], ["rex", "Rex Reporter"], ["ray", "Ray Reporter"]] as const) {
    auth[who] = await signIn(`admin-${who}`, name);
    handle[who] = (await call<{ user: { handle: string } }>(me, "/api/v1/me", { auth: auth[who] })).body.user.handle;
  }
  await deps().db.update(t.users).set({ role: "admin" }).where(eq(t.users.handle, handle.boss));
});
after(async () => deps().close());
beforeEach(() => clock().advance(30_000));

test("admin routes are for admins", async () => {
  assert.equal((await call(overview, "/api/v1/admin/overview")).status, 401);
  assert.equal((await call(overview, "/api/v1/admin/overview", { auth: auth.ann })).status, 403);
  const { status, body } = await call<{ people: { total: number } }>(overview, "/api/v1/admin/overview", { auth: auth.boss });
  assert.equal(status, 200);
  assert.equal(body.people.total, 4);
});

test("flipping the beta gate takes effect at once, and a waitlist invite lets someone in", async () => {
  await call(setFlag, "/api/v1/admin/flags/beta_gate", { auth: auth.boss, method: "PUT", params: { key: "beta_gate" }, body: { enabled: true } });
  const late = await signIn("admin-late", "Lee Late");
  // The gate stands in front of taking part: an order is refused at once.
  const order = (n: number) => ({ market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: `admin-gate-${n}` });
  assert.equal((await call(placeOrder, "/api/v1/orders", { auth: late, body: order(1) })).status, 403, "no ten-second wait");

  await call(waitlist, "/api/v1/waitlist", { body: { email: "lee@example.com" } });
  const sent = await call<{ invited: number; skipped: number }>(inviteWaitlist, "/api/v1/admin/waitlist/invite", {
    auth: auth.boss,
    body: { emails: ["lee@example.com", "nobody@example.com"] },
  });
  assert.deepEqual(sent.body, { invited: 1, skipped: 1 });
  await worker.run("jobs");
  const mail = mailer().sent.find((m) => m.template === "invite" && m.to === "lee@example.com");
  assert.ok(mail);
  await call(redeem, "/api/v1/invites/redeem", { auth: late, body: { code: mail.data.code } });
  assert.equal((await call(placeOrder, "/api/v1/orders", { auth: late, body: order(2) })).status, 201);
  await call(setFlag, "/api/v1/admin/flags/beta_gate", { auth: auth.boss, method: "PUT", params: { key: "beta_gate" }, body: { enabled: false } });
});

test("batches of invites, and revoking one", async () => {
  const batch = await call<{ items: { code: string; maxUses: number }[] }>(issue, "/api/v1/admin/invites", {
    auth: auth.boss,
    body: { count: 2, maxUses: 3, expiresInDays: 7, note: "Macro Twitter" },
  });
  assert.equal(batch.status, 201);
  assert.equal(batch.body.items.length, 2);
  const code = batch.body.items[0].code;
  await call(revoke, `/api/v1/admin/invites/${code}/revoke`, { auth: auth.boss, params: { code } });
  const active = await call<{ items: { code: string }[] }>(invites, "/api/v1/admin/invites?active=true", { auth: auth.boss });
  assert.ok(!active.body.items.some((i) => i.code === code));
});

test("people: access, suspension, and no demoting yourself", async () => {
  const found = await call<{ items: { handle: string; role: string }[] }>(people, `/api/v1/admin/people?q=${handle.ann}`, { auth: auth.boss });
  assert.deepEqual(found.body.items.map((p) => p.handle), [handle.ann]);
  await call(person, `/api/v1/admin/people/${handle.ann}`, { auth: auth.boss, method: "PATCH", params: { handle: handle.ann }, body: { status: "suspended" } });
  const locked = await call<{ error: { message: string } }>(portfolio, "/api/v1/portfolio", { auth: auth.ann });
  assert.equal(locked.status, 403);
  assert.match(locked.body.error.message, /suspended/);
  await call(person, `/api/v1/admin/people/${handle.ann}`, { auth: auth.boss, method: "PATCH", params: { handle: handle.ann }, body: { status: "active" } });
  const self = await call(person, `/api/v1/admin/people/${handle.boss}`, { auth: auth.boss, method: "PATCH", params: { handle: handle.boss }, body: { role: "user" } });
  assert.equal(self.status, 422);
});

test("markets, categories and venues are data an admin can change", async () => {
  await call(market, "/api/v1/admin/markets/btc", { auth: auth.boss, method: "PATCH", params: { slug: "btc" }, body: { hidden: true } });
  const listed = await call<{ items: { id: string }[] }>(markets, "/api/v1/markets?limit=100&status=all");
  assert.ok(!listed.body.items.some((m) => m.id === "btc"), "hidden from the catalog");
  const mapped = await call<{ items: { venueCategory: string; category: string }[] }>(mapping, "/api/v1/admin/category-map", {
    auth: auth.boss,
    method: "PUT",
    body: { venueId: "kalshi", venueCategory: "Awards", category: "Culture" },
  });
  assert.ok(mapped.body.items.some((m) => m.venueCategory === "awards" && m.category === "Culture"));
  const staged = await call<{ stage: string }>(venue, "/api/v1/admin/venues/kalshi", { auth: auth.boss, method: "PATCH", params: { id: "kalshi" }, body: { stage: "paper" } });
  assert.equal(staged.body.stage, "paper");
});

test("reports gather per post; one decision resolves them all", async () => {
  const created = await call<{ id: string }>(post, "/api/v1/posts", {
    auth: auth.ann,
    body: { market: "fed-dec", outcome: "Yes", text: "Guaranteed 10x — DM me for the signal group, spots are limited today only!!", confidence: "High" },
  });
  for (const who of ["rex", "ray"])
    await call(report, "/api/v1/reports", { auth: auth[who], body: { subjectType: "post", subjectId: created.body.id, reason: "spam" } });
  const self = await call(report, "/api/v1/reports", { auth: auth.ann, body: { subjectType: "post", subjectId: created.body.id, reason: "spam" } });
  assert.equal(self.status, 422);

  const open = await call<{ items: { id: string; reports: number; author: { handle: string } }[] }>(queue, "/api/v1/admin/reports", { auth: auth.boss });
  assert.equal(open.body.items[0].reports, 2);
  assert.equal(open.body.items[0].author.handle, handle.ann);
  const done = await call<{ resolved: number }>(resolve, `/api/v1/admin/reports/${open.body.items[0].id}`, {
    auth: auth.boss,
    params: { id: open.body.items[0].id },
    body: { action: "remove" },
  });
  assert.equal(done.body.resolved, 2);
  assert.equal((await call(getPost, `/api/v1/posts/${created.body.id}`, { params: { id: created.body.id } })).status, 404);
  const again = await call(resolve, `/api/v1/admin/reports/${open.body.items[0].id}`, { auth: auth.boss, params: { id: open.body.items[0].id }, body: { action: "dismiss" } });
  assert.equal(again.status, 409);
});

test("dead jobs can be retried, and every change is in the audit trail", async () => {
  const [job] = await deps().db.insert(t.jobs).values({ name: "mail.send", payload: {}, status: "dead", attempts: 5, lastError: "boom" }).returning();
  const dead = await call<{ items: { id: string }[] }>(jobs, "/api/v1/admin/jobs?status=dead", { auth: auth.boss });
  assert.ok(dead.body.items.some((j) => j.id === job.id));
  await call(retry, `/api/v1/admin/jobs/${job.id}/retry`, { auth: auth.boss, params: { id: job.id } });
  const [row] = await deps().db.select().from(t.jobs).where(eq(t.jobs.id, job.id));
  assert.equal(row.status, "pending");

  const trail = await call<{ items: { action: string; actor: string }[] }>(auditTrail, "/api/v1/admin/audit", { auth: auth.boss });
  const actions = new Set(trail.body.items.map((i) => i.action));
  for (const action of ["flag.set", "waitlist.invite", "invites.issue", "invite.revoke", "person.update", "market.update", "category-map.set", "venue.update", "report.remove", "job.retry"])
    assert.ok(actions.has(action), action);
  assert.ok(trail.body.items.every((i) => i.actor === handle.boss));
});
