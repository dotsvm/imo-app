import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { createWorker } from "@imo/server/worker";
import { takeLease } from "@imo/server/worker/leases";
import { GET as listOrders, POST as place } from "../../src/app/api/v1/orders/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { POST as claim } from "../../src/app/api/v1/positions/[id]/claim/route";
import { GET as notifications } from "../../src/app/api/v1/notifications/route";
import { POST as readNotifications } from "../../src/app/api/v1/notifications/read/route";
import { GET as stream } from "../../src/app/api/v1/stream/route";
import { GET as config } from "../../src/app/api/v1/config/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void; now(): Date };
const venue = () => deps().venues.fixture!;
const realtime = () =>
  deps().realtime as unknown as { messages: { channel: string; event: string; payload: Record<string, unknown> }[] };

let worker: ReturnType<typeof createWorker>;
const users: Record<string, string> = {};
let n = 0;
const cid = () => `worker-order-${n++}`;

async function slugOf(externalId: string) {
  const [row] = await deps()
    .db.select({ slug: t.markets.slug })
    .from(t.markets)
    .where(eq(t.markets.externalId, externalId));
  return row.slug;
}

type OrderView = { id: string; status: string; filledShares: number; averagePriceCents: number | null; resting: boolean; remainingShares: number };
async function restingBuy(user: string, externalId: string, shares: number, limitCents: number) {
  const { status, body } = await call<OrderView>(place, "/api/v1/orders", {
    auth: users[user],
    body: { market: await slugOf(externalId), side: "Buy", outcome: "Yes", type: "limit", limitCents, shares, clientOrderId: cid() },
  });
  assert.equal(status, 201);
  assert.equal(body.status, "pending");
  return body.id;
}

async function order(user: string, id: string) {
  const { body } = await call<{ items: OrderView[] }>(listOrders, "/api/v1/orders", { auth: users[user] });
  return body.items.find((o) => o.id === id)!;
}

type Portfolio = {
  account: { cashCents: number; reservedCents: number };
  positions: { id: string; shares: number; costCents: number; feeCents: number }[];
  claims: { positionId: string; payoutCents: number }[];
};
const holdings = async (user: string) => (await call<Portfolio>(portfolio, "/api/v1/portfolio", { auth: users[user] })).body;

async function ledgerBalanced() {
  const rows = await deps().db.execute<{ ok: boolean }>(sql`
    select bool_and(a.cash = coalesce(l.total, 0)) as ok
    from trading_accounts a
    left join (select account_id, sum(amount) as total from ledger_entries group by account_id) l
      on l.account_id = a.id`);
  assert.equal(rows[0].ok, true, "every account's cash equals its ledger");
}

/** The relay runs until the outbox is empty: handlers can append events. */
async function relayAll() {
  for (let i = 0; i < 5; i++) {
    const result = (await worker.run("outbox")) as { seen: number };
    if (!result.seen) return;
  }
}

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  worker = createWorker(deps(), { holder: "test-worker" });
  users.maker = await signIn("worker-maker", "Maya Maker");
  users.first = await signIn("worker-first", "Frank First");
  users.second = await signIn("worker-second", "Sam Second");
});
after(async () => deps().close());

test("lanes follow the data sources, and the design dataset has no feed", () => {
  const names = worker.lanes.map((l) => l.name);
  assert.ok(names.includes("catalog:fixture"));
  assert.ok(!names.some((name) => name.endsWith(":demo-design")));
});

test("a venue without display rights isn't fetched at all, until they're granted", async () => {
  const rights = (displayAllowed: boolean) =>
    deps().db.update(t.venues).set({ displayAllowed }).where(eq(t.venues.id, "fixture"));
  await rights(false);
  try {
    for (const lane of ["catalog:fixture", "series:fixture", "status:fixture"])
      assert.deepEqual(await worker.run(lane), { skipped: "no display rights" }, lane);
    const [{ count }] = await deps()
      .db.select({ count: sql<number>`count(*)::int` })
      .from(t.markets)
      .where(eq(t.markets.venueId, "fixture"));
    assert.equal(count, 0);
  } finally {
    await rights(true);
  }
});

test("a catalog pass lists the venue, prices every card, then skips what didn't change", async () => {
  const first = (await worker.run("catalog:fixture")) as { inserted: number; complete: boolean; pages: number };
  assert.equal(first.inserted, 6);
  assert.equal(first.complete, true);
  assert.equal(first.pages, 2);
  const [quote] = await deps()
    .db.select({ bid: t.marketQuotes.yesBid, ask: t.marketQuotes.yesAsk, last: t.marketQuotes.last })
    .from(t.marketQuotes)
    .innerJoin(t.markets, eq(t.markets.id, t.marketQuotes.marketId))
    .where(eq(t.markets.externalId, "FX-RATES-DEC"));
  assert.deepEqual(quote, { bid: 610_000, ask: 630_000, last: 620_000 });

  clock().advance(60_000);
  const second = (await worker.run("catalog:fixture")) as { inserted: number; updated: number; unchanged: number };
  assert.deepEqual([second.inserted, second.updated, second.unchanged], [0, 0, 6]);
});

test("a resting limit fills as a maker when the book comes to it", async () => {
  const id = await restingBuy("maker", "FX-RATES-DEC", 50, 60);
  assert.ok((await holdings("maker")).account.reservedCents > 3000);

  venue().setYes("FX-RATES-DEC", 58); // asks now start at 59¢
  const hot = (await worker.run("hot")) as { fills: number };
  assert.equal(hot.fills, 1);

  const filled = await order("maker", id);
  assert.deepEqual([filled.status, filled.filledShares, filled.averagePriceCents], ["filled", 50, 60]);
  const p = await holdings("maker");
  assert.equal(p.account.reservedCents, 0, "the reservation is released");
  // Makers pay no fixture venue fee; Hunch's 0.5% of $30.00 is $0.15.
  assert.deepEqual([p.positions[0].shares, p.positions[0].costCents, p.positions[0].feeCents], [50, 3000, 15]);
  assert.equal(p.account.cashCents, 1_000_000 - 3015);
  await ledgerBalanced();

  const slug = await slugOf("FX-RATES-DEC");
  const events = realtime().messages.filter((m) => m.channel === `market:${slug}`).map((m) => m.event);
  assert.ok(events.includes("quote") && events.includes("book"), "viewers see the new price and book");
});

test("resting orders share the book's depth in time priority", async () => {
  venue().setYes("FX-RATES-DEC", 62);
  const first = await restingBuy("first", "FX-RATES-DEC", 80, 59);
  const second = await restingBuy("second", "FX-RATES-DEC", 80, 59);
  venue().setYes("FX-RATES-DEC", 58); // 100 shares offered at 59¢
  await worker.run("hot");

  const a = await order("first", first);
  const b = await order("second", second);
  assert.deepEqual([a.status, a.filledShares], ["filled", 80]);
  assert.deepEqual([b.status, b.filledShares, b.resting, b.remainingShares], ["partial", 20, true, 60]);
  const reserved = (await holdings("second")).account.reservedCents;
  assert.ok(reserved > 3540 && reserved < 3700, `60 × 59¢ plus fees stays held (${reserved})`);
  await ledgerBalanced();
});

test("fills reach their owners as notifications and realtime", async () => {
  await relayAll();
  const { body } = await call<{ items: { title: string; body: string }[]; unread: number }>(notifications, "/api/v1/notifications", {
    auth: users.maker,
  });
  assert.equal(body.items[0].title, "Order filled");
  assert.equal(body.items[0].body, "50 Yes · Rates cut in December at 60¢. Total $30.15 including fees.");
  const partial = await call<{ items: { title: string; body: string }[] }>(notifications, "/api/v1/notifications", {
    auth: users.second,
  });
  assert.equal(partial.body.items[0].title, "Order partially filled");
  assert.match(partial.body.items[0].body, /^20 of 80 Yes · Rates cut in December filled at your 59¢ limit/);
  assert.ok(realtime().messages.some((m) => m.channel.startsWith("user:") && m.event === "notification"));

  await relayAll();
  const again = await call<{ items: unknown[] }>(notifications, "/api/v1/notifications", { auth: users.maker });
  assert.equal(again.body.items.length, body.items.length, "a replayed event doesn't notify twice");

  const read = await call<{ read: number }>(readNotifications, "/api/v1/notifications/read", { auth: users.maker, body: { all: true } });
  assert.ok(read.body.read >= 1);
  const after = await call<{ unread: number }>(notifications, "/api/v1/notifications", { auth: users.maker });
  assert.equal(after.body.unread, 0);
});

test("a market that closes cancels its resting orders and says why", async () => {
  const id = await restingBuy("first", "FX-CPI-OCT", 10, 30);
  venue().setStatus("FX-CPI-OCT", "closed");
  clock().advance(60_000);
  const sync = (await worker.run("catalog:fixture")) as { updated: number };
  assert.equal(sync.updated, 1);
  await relayAll();

  const cancelled = await order("first", id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await holdings("first")).account.reservedCents, 0);
  const { body } = await call<{ items: { title: string; body: string }[] }>(notifications, "/api/v1/notifications", {
    auth: users.first,
  });
  assert.equal(body.items[0].title, "Order cancelled");
  assert.equal(body.items[0].body, "October CPI above 3.0%: The market closed before your limit was reached.");
});

test("a result the listing leaves out is found by lookup, and settles once", async () => {
  venue().unlist("FX-RATES-DEC");
  venue().resolve("FX-RATES-DEC", "yes");
  clock().advance(60_000);
  const sync = (await worker.run("catalog:fixture")) as { reconciled: number };
  assert.ok(sync.reconciled >= 1, "the unlisted market was looked up");
  const [market] = await deps()
    .db.select({ status: t.markets.status, resolution: t.markets.resolution })
    .from(t.markets)
    .where(eq(t.markets.externalId, "FX-RATES-DEC"));
  assert.deepEqual(market, { status: "resolved", resolution: market.resolution });
  assert.equal(market.resolution?.final, true);

  await relayAll(); // market.resolved → a settlement job
  await worker.run("jobs");
  await relayAll(); // position.settled → notifications

  const maker = await holdings("maker");
  assert.deepEqual(maker.claims.map((c) => [c.payoutCents]), [[5_000]]);
  const second = await holdings("second");
  assert.deepEqual(second.claims.map((c) => c.payoutCents), [2_000]);
  assert.equal(second.account.reservedCents, 0, "the resolved market's resting order let go");

  const { body } = await call<{ items: { title: string; body: string; cta?: { label: string } }[] }>(
    notifications,
    "/api/v1/notifications",
    { auth: users.maker },
  );
  const notice = body.items.find((i) => i.title === "Rates cut in December resolved Yes");
  assert.ok(notice);
  assert.equal(notice.body, "50 Yes × $1.00 payout. Cost basis $30.15 → profit +$19.85 once claimed.");
  assert.equal(notice.cta?.label, "Claim $50.00");

  // The sweep finds nothing left to pay for this market.
  await worker.run("settle-sweep");
  const settlements = await deps()
    .db.select()
    .from(t.settlements)
    .innerJoin(t.markets, eq(t.markets.id, t.settlements.marketId))
    .where(eq(t.markets.externalId, "FX-RATES-DEC"));
  assert.equal(settlements.length, 1);

  const slug = await slugOf("FX-RATES-DEC");
  const paid = await call(claim, `/api/v1/positions/${slug}:yes/claim`, {
    auth: users.maker,
    method: "POST",
    params: { id: `${slug}:yes` },
  });
  assert.equal(paid.status, 200);
  await ledgerBalanced();
});

test("the venue's trading status pauses the ticket", async () => {
  venue().setTrading(false, "2026-09-25T16:00:00Z");
  await worker.run("status:fixture");
  const [status] = await deps().db.select().from(t.venueStatus).where(eq(t.venueStatus.venueId, "fixture"));
  assert.equal(status.tradingActive, false);
  const refused = await call<{ error: { code: string } }>(place, "/api/v1/orders", {
    auth: users.first,
    body: { market: await slugOf("FX-BTC-150K"), side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: cid() },
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, "venue_paused");
  venue().setTrading(true);
  await worker.run("status:fixture");
});

test("trending ranks the open markets", async () => {
  await worker.run("trending");
  const rows = await deps()
    .db.select({ rank: t.marketTrending.rank, id: t.markets.externalId })
    .from(t.marketTrending)
    .innerJoin(t.markets, eq(t.markets.id, t.marketTrending.marketId))
    .orderBy(t.marketTrending.rank);
  // By now the others have closed, resolved or paused: only open markets trend.
  assert.deepEqual(rows, [{ rank: 1, id: "FX-BTC-150K" }]);
});

test("an exclusive lane runs on one replica at a time", async () => {
  const { db } = deps();
  const now = clock().now();
  assert.equal(await takeLease(db, "test-lane", "a", 10_000, now), true);
  assert.equal(await takeLease(db, "test-lane", "b", 10_000, now), false);
  assert.equal(await takeLease(db, "test-lane", "a", 10_000, now), true, "the holder renews");
  assert.equal(await takeLease(db, "test-lane", "b", 10_000, new Date(now.getTime() + 11_000)), true, "a lapsed lease moves");

  await worker.run("hot");
  const other = createWorker(deps(), { holder: "other-replica" });
  assert.deepEqual(await other.run("hot"), { skipped: true });
});

test("the stream relays a market's updates, and guards private channels", async () => {
  const slug = await slugOf("FX-BTC-150K");
  const controller = new AbortController();
  const res = await stream(
    new NextRequest(`http://localhost/api/v1/stream?channels=market:${slug}`, {
      headers: { "x-forwarded-for": "10.7.0.1" },
      signal: controller.signal,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("event: ready")) text += decoder.decode((await reader.read()).value);
  await deps().realtime.publish(`market:${slug}`, "quote", { yesPriceCents: 21 });
  while (!text.includes("event: quote")) text += decoder.decode((await reader.read()).value);
  assert.match(text, /"yesPriceCents":21/);
  controller.abort();
  await reader.cancel().catch(() => {});

  const someoneElse = await call<{ error: { code: string } }>(stream, "/api/v1/stream?channels=user:00000000-0000-0000-0000-000000000000", {
    auth: users.first,
  });
  assert.equal(someoneElse.status, 403);
  const room = await call(stream, "/api/v1/stream?channels=room:00000000-0000-0000-0000-000000000000", { auth: users.first });
  assert.equal(room.status, 403);
});

test("the client config says how to connect", async () => {
  const { body } = await call<{ realtime: { kind: string }; auth: { dev: boolean }; paper: { startingBalanceCents: number } }>(
    config,
    "/api/v1/config",
  );
  assert.equal(body.realtime.kind, "sse");
  assert.equal(body.auth.dev, true);
  assert.equal(body.paper.startingBalanceCents, 1_000_000);
});

test("no account ever owes money or holds more than it has", async () => {
  const bad = await deps()
    .db.select({ id: t.tradingAccounts.id })
    .from(t.tradingAccounts)
    .where(and(sql`${t.tradingAccounts.cash} < 0 or ${t.tradingAccounts.reserved} > ${t.tradingAccounts.cash}`));
  assert.equal(bad.length, 0);
  await ledgerBalanced();
});

test("a market listed before its tags mapped takes its category once they do", async () => {
  const { markets } = await import("@imo/server/db/schema");
  const { loadCategoryMap, upsertMarkets } = await import("@imo/server/usecases/ingest");
  const [listed] = (await deps().venues.sources.get("fixture")!.listMarkets()).items;
  const ref = { ...listed.ref, externalId: "late-tags" };
  const options = { source: "fixture", log: deps().log, categories: await loadCategoryMap(deps().db), slug: () => "late-tags" };
  const read = async () =>
    (await deps().db.select({ category: markets.category, hidden: markets.hidden }).from(markets).where(eq(markets.externalId, "late-tags")))[0];
  await upsertMarkets(deps().db, [{ ...listed, ref, categoryHints: [] }], options);
  assert.deepEqual(await read(), { category: "Uncategorized", hidden: true }, "no hint maps: kept out of listings");
  await upsertMarkets(deps().db, [{ ...listed, ref, categoryHints: ["fixture"] }], options);
  assert.deepEqual(await read(), { category: "Economics", hidden: false }, "the next pass brings its tags");
  // An admin's hand-set category stands.
  await deps().db.update(markets).set({ category: "Science" }).where(eq(markets.externalId, "late-tags"));
  await upsertMarkets(deps().db, [{ ...listed, ref, title: `${listed.title} (edited)`, categoryHints: ["fixture"] }], options);
  assert.equal((await read()).category, "Science");
});

test("a tag mapped later reaches markets whose details never changed", async () => {
  const { categoryMap, markets } = await import("@imo/server/db/schema");
  const { loadCategoryMap, upsertMarkets } = await import("@imo/server/usecases/ingest");
  const [listed] = (await deps().venues.sources.get("fixture")!.listMarkets()).items;
  const market = { ...listed, ref: { ...listed.ref, externalId: "new-tag" }, categoryHints: ["brand-new-tag"] };
  const options = async () => ({ source: "fixture", log: deps().log, categories: await loadCategoryMap(deps().db), slug: () => "new-tag" });
  const read = async () =>
    (await deps().db.select({ category: markets.category, hidden: markets.hidden }).from(markets).where(eq(markets.externalId, "new-tag")))[0];
  await upsertMarkets(deps().db, [market], await options());
  assert.deepEqual(await read(), { category: "Uncategorized", hidden: true });
  await deps().db.insert(categoryMap).values({ venueId: "fixture", venueCategory: "brand-new-tag", category: "Science" });
  const again = await upsertMarkets(deps().db, [market], await options());
  assert.equal(again.updated, 1, "the same listing, now mapped");
  assert.deepEqual(await read(), { category: "Science", hidden: false });
});
