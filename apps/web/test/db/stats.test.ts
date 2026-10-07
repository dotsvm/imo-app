import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { settleMarket } from "@imo/server/usecases/portfolio";
import { MIN_SAMPLE } from "@imo/server/usecases/stats";
import { createWorker } from "@imo/server/worker";
import { GET as me, PATCH as patchMe } from "../../src/app/api/v1/me/route";
import { POST as order } from "../../src/app/api/v1/orders/route";
import { POST as claim } from "../../src/app/api/v1/positions/[id]/claim/route";
import { GET as board } from "../../src/app/api/v1/leaderboard/route";
import { GET as trader } from "../../src/app/api/v1/traders/[handle]/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void; now(): Date };
let worker: ReturnType<typeof createWorker>;
const auth: Record<string, string> = {};
const handle: Record<string, string> = {};
let n = 0;

const buy = (who: string, market: string, outcome: "Yes" | "No", amountCents: number) =>
  call(order, "/api/v1/orders", { auth: auth[who], body: { market, side: "Buy", outcome, amountCents, clientOrderId: `stats-${who}-${n++}` } });

async function resolve(slug: string, outcome: "yes" | "no") {
  const { db } = deps();
  const [market] = await db
    .update(t.markets)
    .set({ status: "resolved", resolution: { outcome, final: true } })
    .where(eq(t.markets.slug, slug))
    .returning();
  await settleMarket(db, market.id, clock().now());
}

type Stats = { returnPct: number; correct: number; resolved: number; trades: number; pnlCents: number };

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "stats-tests" });
  for (const [who, name] of [["ada", "Ada Lovelace"], ["bo", "Bo Diddley"]] as const) {
    auth[who] = await signIn(`stats-${who}`, name);
    handle[who] = (await call<{ user: { handle: string } }>(me, "/api/v1/me", { auth: auth[who] })).body.user.handle;
  }
});
after(async () => deps().close());
beforeEach(() => clock().advance(60_000));

test("a record is built from what happened: one right call, one wrong", async () => {
  await buy("ada", "fed-dec", "Yes", 10_000); // 153 Yes at 63¢, $99.37 with fees
  await buy("ada", "cpi-oct", "No", 5_000);
  await buy("bo", "btc", "Yes", 2_000);
  clock().advance(86_400_000);
  await resolve("fed-dec", "yes");
  await resolve("cpi-oct", "yes");
  const slug = "fed-dec";
  await call(claim, `/api/v1/positions/${slug}:yes/claim`, { auth: auth.ada, method: "POST", params: { id: `${slug}:yes` } });

  await worker.run("equity");
  await worker.run("stats");
  const { body } = await call<{ stats: Record<string, Stats>; record: Record<string, number | string> }>(trader, `/api/v1/traders/${handle.ada}`, {
    params: { handle: handle.ada },
  });
  const all = body.stats.All;
  assert.deepEqual([all.resolved, all.correct, all.trades], [2, 1, 2]);
  // +$53.63 on the Fed call, minus what the CPI No cost.
  const [ada] = await deps()
    .db.select({ cash: t.tradingAccounts.cash })
    .from(t.tradingAccounts)
    .innerJoin(t.users, eq(t.users.id, t.tradingAccounts.userId))
    .where(eq(t.users.handle, handle.ada));
  assert.equal(all.pnlCents, (ada.cash - 10_000_000_000) / 10_000, "P&L is the equity change");
  assert.equal(body.record.winTrades, 1);
  assert.equal(body.record.lossTrades, 1);
  assert.match(String(body.record.biggestLossOn), /^Oct CPI above 3\.0% · No$/);
  assert.ok(Number(body.record.feesCents) > 0);
});

test("the leaderboard ranks by P&L, return or accuracy, with the beta's floor", async () => {
  type Board = { minSample: number; items: { rank: number; trader: { handle: string }; lowSample: boolean }[]; you: { rank: number | null; qualifies: boolean } | null };
  const floor = await call<Board>(board, "/api/v1/leaderboard?period=All", { auth: auth.ada });
  assert.equal(floor.body.minSample, MIN_SAMPLE);
  assert.deepEqual(floor.body.items, [], `nobody has ${MIN_SAMPLE} resolved calls yet`);
  assert.equal(floor.body.you?.qualifies, false);

  const open = await call<Board>(board, "/api/v1/leaderboard?period=All&sample=off&sort=pnl", { auth: auth.bo });
  assert.deepEqual(open.body.items.map((i) => i.trader.handle), [handle.ada, handle.bo], "Ada's winning call puts her first");
  assert.ok(open.body.items.every((i) => i.lowSample));
  assert.equal(open.body.you?.rank, 2);

  await call(patchMe, "/api/v1/me", { auth: auth.bo, method: "PATCH", body: { appearOnLeaderboard: false } });
  const hidden = await call<Board>(board, "/api/v1/leaderboard?period=All&sample=off", { auth: auth.bo });
  assert.deepEqual(hidden.body.items.map((i) => i.trader.handle), [handle.ada], "opted out: off the board");
  assert.equal(hidden.body.you?.rank, null);
});

test("stats rows cover every period, and categories only count their own markets", async () => {
  const [ada] = await deps().db.select({ id: t.users.id }).from(t.users).where(eq(t.users.handle, handle.ada));
  const rows = await deps().db.select().from(t.traderStats).where(eq(t.traderStats.userId, ada.id));
  assert.deepEqual([...new Set(rows.map((r) => r.period))].sort(), ["30D", "7D", "90D", "All"]);
  const economics = rows.find((r) => r.period === "All" && r.category === "Economics");
  assert.deepEqual([economics?.resolved, economics?.correct], [2, 1]);
  const [crypto] = await deps()
    .db.select()
    .from(t.traderStats)
    .where(and(eq(t.traderStats.category, "Crypto"), eq(t.traderStats.userId, ada.id)));
  assert.equal(crypto, undefined, "Ada never traded crypto");
});
