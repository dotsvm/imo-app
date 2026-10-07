/**
 * Track records, computed from what actually happened — fills, closes,
 * settlements and daily equity — never from anything a person types in.
 * Everything is scoped to the current season: a reset starts a clean record.
 *
 * - P&L and return: equity now against equity when the period began.
 * - Right: of the calls whose markets resolved in the period, how many were on
 *   the winning side (voided markets don't count either way).
 * - The record: wins and losses, right-but-lost and wrong-but-won, holding
 *   time, fees, the deepest drawdown and the biggest single loss.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { bidFor } from "./portfolio";
import { traderSummaries } from "./people";
import type { Viewer } from "./viewer";

import { MIN_SAMPLE } from "../catalogs";
export { MIN_SAMPLE };
const DAY = 86_400_000;
export const PERIODS = { "7D": 7, "30D": 30, "90D": 90, All: null } as const;
type Period = keyof typeof PERIODS;

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/** Cash plus every open position at what it would sell for now. */
export async function equityOf(db: Db, accountId: string) {
  const [account] = await db.select().from(t.tradingAccounts).where(eq(t.tradingAccounts.id, accountId));
  if (!account) return null;
  const held = await db
    .select({ position: t.positions, market: t.markets, quote: t.marketQuotes })
    .from(t.positions)
    .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
    .leftJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .where(eq(t.positions.accountId, accountId));
  let positionsValue = 0;
  let unrealized = 0;
  for (const { position, market, quote } of held) {
    const value = Math.floor((position.quantity * bidFor(position.outcome, quote, market)) / 10 ** market.quantityScale);
    positionsValue += value;
    unrealized += value - position.cost - position.fees;
  }
  // Payouts waiting to be claimed are the trader's money already.
  const [{ claimable }] = await db
    .select({ claimable: sql<number>`coalesce(sum(${t.claims.payout}), 0)::bigint` })
    .from(t.claims)
    .where(and(eq(t.claims.accountId, accountId), eq(t.claims.status, "claimable")));
  return {
    account,
    equity: account.cash + positionsValue + Number(claimable),
    cash: account.cash,
    positionsValue: positionsValue + Number(claimable),
    unrealized,
  };
}

/** Today's equity row for every paper account (upserted: run it hourly). */
export async function snapshotEquity(db: Db, now: Date) {
  const accounts = await db
    .select({ id: t.tradingAccounts.id })
    .from(t.tradingAccounts)
    .innerJoin(t.users, eq(t.users.id, t.tradingAccounts.userId))
    .where(and(eq(t.users.isDemo, false), isNull(t.users.deletedAt)));
  const day = dayOf(now);
  for (const { id } of accounts) {
    const value = await equityOf(db, id);
    if (!value) continue;
    const row = { equity: value.equity, cash: value.cash, positionsValue: value.positionsValue };
    await db
      .insert(t.equityDaily)
      .values({ accountId: id, day, ...row })
      .onConflictDoUpdate({ target: [t.equityDaily.accountId, t.equityDaily.day], set: row });
  }
  return { accounts: accounts.length };
}

interface Call {
  marketId: string;
  outcome: string;
  category: string;
  title: string;
  pnl: number;
  result: string | null;
  settledAt: Date | null;
}

/** Every trader's stats for every period and category, from scratch. */
export async function computeTraderStats(db: Db, userId: string, now: Date) {
  const [account] = await db.select().from(t.tradingAccounts).where(eq(t.tradingAccounts.userId, userId));
  if (!account) return null;
  const value = await equityOf(db, account.id);
  if (!value) return null;
  const seasonStart = account.lastResetAt ?? account.createdAt;
  const [closes, fills, equity, [{ posts }]] = await Promise.all([
    db
      .select({ close: t.realizedPnl, category: t.markets.category, title: t.markets.shortTitle, resolution: t.markets.resolution, settledAt: t.settlements.settledAt })
      .from(t.realizedPnl)
      .innerJoin(t.markets, eq(t.markets.id, t.realizedPnl.marketId))
      .leftJoin(t.settlements, eq(t.settlements.marketId, t.realizedPnl.marketId))
      .where(and(eq(t.realizedPnl.accountId, account.id), gte(t.realizedPnl.closedAt, seasonStart))),
    db
      .select({ at: t.fills.createdAt, fee: t.fills.feeTotal, category: t.markets.category })
      .from(t.fills)
      .innerJoin(t.markets, eq(t.markets.id, t.fills.marketId))
      .where(and(eq(t.fills.accountId, account.id), gte(t.fills.createdAt, seasonStart))),
    db
      .select()
      .from(t.equityDaily)
      .where(and(eq(t.equityDaily.accountId, account.id), gte(t.equityDaily.day, dayOf(seasonStart))))
      .orderBy(t.equityDaily.day),
    db.select({ posts: sql<number>`count(*)::int` }).from(t.posts).where(and(eq(t.posts.authorId, userId), isNull(t.posts.deletedAt))),
  ]);

  // Calls: one per market and side, with its net result and how it resolved.
  const calls = new Map<string, Call>();
  for (const { close, category, title, resolution, settledAt } of closes) {
    const key = `${close.marketId}:${close.outcome}`;
    const call = calls.get(key) ?? {
      marketId: close.marketId,
      outcome: close.outcome,
      category,
      title,
      pnl: 0,
      result: resolution?.final ? resolution.outcome : null,
      settledAt: settledAt ?? null,
    };
    call.pnl += close.pnl;
    calls.set(key, call);
  }

  const startEquity = (period: Period) => {
    const days = PERIODS[period];
    const from = days === null ? seasonStart : new Date(Math.max(now.getTime() - days * DAY, seasonStart.getTime()));
    if (from.getTime() <= seasonStart.getTime() + DAY) return { from, equity: account.startingBalance };
    const before = equity.filter((e) => e.day <= dayOf(from)).at(-1);
    return { from, equity: before?.equity ?? account.startingBalance };
  };

  const rows: (typeof t.traderStats.$inferInsert)[] = [];
  const categories = ["All", ...new Set([...calls.values()].map((c) => c.category))];
  for (const period of Object.keys(PERIODS) as Period[]) {
    const start = startEquity(period);
    for (const category of categories) {
      const inCategory = (c: { category: string }) => category === "All" || c.category === category;
      const resolved = [...calls.values()].filter(
        (c) => inCategory(c) && c.result && c.result !== "void" && c.settledAt && c.settledAt >= start.from,
      );
      // Overall P&L is the equity change; a category's is what closed in it.
      const pnl =
        category === "All"
          ? value.equity - start.equity
          : closes
              .filter((c) => c.category === category && c.close.closedAt >= start.from)
              .reduce((sum, c) => sum + c.close.pnl, 0);
      const capital = start.equity;
      rows.push({
        userId,
        period,
        category,
        returnPct: capital ? Math.round((pnl / capital) * 1_000) / 10 : 0,
        correct: resolved.filter((c) => c.result === c.outcome).length,
        resolved: resolved.length,
        trades: fills.filter((f) => inCategory(f) && f.at >= start.from).length,
        pnl,
        startingCapital: capital,
        computedAt: now,
      });
    }
  }

  // The record (whole season).
  const all = rows.find((r) => r.period === "All" && r.category === "All")!;
  const closed = closes.map((c) => c.close);
  let peak = account.startingBalance;
  let peakDay = dayOf(seasonStart);
  let drawdown = 0;
  let window = "peak to trough";
  for (const e of equity) {
    if (e.equity > peak) {
      peak = e.equity;
      peakDay = e.day;
    }
    if (peak - e.equity > drawdown) {
      drawdown = peak - e.equity;
      window = `${shortDay(peakDay)}–${shortDay(e.day)}`;
    }
  }
  const worst = [...calls.values()].sort((a, b) => a.pnl - b.pnl)[0];
  const decided = [...calls.values()].filter((c) => c.result && c.result !== "void");
  all.record = {
    rightNotProfitable: decided.filter((c) => c.result === c.outcome && c.pnl < 0).length,
    profitableNotRight: decided.filter((c) => c.result !== c.outcome && c.pnl > 0).length,
    winTrades: closed.filter((c) => c.pnl > 0).length,
    lossTrades: closed.filter((c) => c.pnl < 0).length,
    avgHoldDays: closed.length
      ? Math.round((closed.reduce((s, c) => s + (c.closedAt.getTime() - c.openedAt.getTime()), 0) / closed.length / DAY) * 10) / 10
      : 0,
    feesCents: cents(fills.reduce((s, f) => s + f.fee, 0)),
    maxDrawdownCents: -cents(drawdown),
    biggestLossCents: worst && worst.pnl < 0 ? cents(worst.pnl) : 0,
    biggestLossOn: worst && worst.pnl < 0 ? `${worst.title} · ${worst.outcome === "yes" ? "Yes" : "No"}` : "no losses yet",
    drawdownWindow: window,
    realizedCents: cents(closed.reduce((s, c) => s + c.pnl, 0)),
    unrealizedCents: cents(value.unrealized),
    predictions: posts,
  };
  // Cumulative P&L by day, for the profile chart: every period.
  for (const period of Object.keys(PERIODS) as Period[]) {
    const row = rows.find((r) => r.period === period && r.category === "All")!;
    const start = startEquity(period);
    // Zero where the period starts, each day's close, and now: never fewer
    // than two points, so there's always a line to draw.
    row.curve = [
      0,
      ...equity.filter((e) => e.day > dayOf(start.from) && e.day < dayOf(now)).map((e) => e.equity - start.equity),
      value.equity - start.equity,
    ];
  }

  await db.transaction(async (tx) => {
    await tx.delete(t.traderStats).where(eq(t.traderStats.userId, userId));
    await tx.insert(t.traderStats).values(rows);
  });
  return rows;
}

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Recompute everyone who traded or held anything (the demo's people keep
    their seeded records). */
export async function refreshStats(db: Db, now: Date) {
  const users = await db
    .select({ id: t.users.id })
    .from(t.users)
    .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.userId, t.users.id))
    .where(
      and(
        eq(t.users.isDemo, false),
        isNull(t.users.deletedAt),
        sql`(exists (select 1 from fills f where f.account_id = ${t.tradingAccounts.id})
          or exists (select 1 from positions p where p.account_id = ${t.tradingAccounts.id}))`,
      ),
    );
  for (const { id } of users) await computeTraderStats(db, id, now);
  return { traders: users.length };
}

export const LEADERBOARD_SORTS = ["pnl", "roi", "right"] as const;

export async function leaderboard(
  db: Db,
  viewer: Viewer | null,
  query: { period?: Period; sort?: (typeof LEADERBOARD_SORTS)[number]; category?: string; sample?: boolean; limit?: number; cursor?: string },
) {
  const period = query.period ?? "30D";
  const sort = query.sort ?? "pnl";
  const sample = query.sample ?? true;
  const limit = Math.min(query.limit ?? 50, 100);
  const offset = query.cursor ? Number(Buffer.from(query.cursor, "base64url").toString()) || 0 : 0;
  const metric =
    sort === "roi"
      ? sql`${t.traderStats.returnPct}`
      : sort === "right"
        ? sql`(${t.traderStats.correct}::float / nullif(${t.traderStats.resolved}, 0))`
        : sql`${t.traderStats.pnl}`;
  const eligible = and(
    eq(t.traderStats.period, period),
    eq(t.traderStats.category, "All"),
    eq(t.userSettings.appearOnLeaderboard, true),
    isNull(t.users.deletedAt),
    eq(t.users.status, "active"),
    query.category ? sql`${query.category} = any(${t.userSettings.interests})` : undefined,
  );
  const ranked = await db
    .select({ user: t.users, stats: t.traderStats })
    .from(t.traderStats)
    .innerJoin(t.users, eq(t.users.id, t.traderStats.userId))
    .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .where(and(eligible, sample ? gte(t.traderStats.resolved, MIN_SAMPLE) : undefined))
    .orderBy(desc(metric), t.users.id)
    .limit(limit + 1)
    .offset(offset);
  const page = ranked.slice(0, limit);
  const people = await traderSummaries(db, viewer, page.map((r) => r.user));
  // The board's fee and drawdown columns come from each season record, so
  // the page needs no profile per row.
  const seasons = page.length
    ? await db
        .select({ userId: t.traderStats.userId, record: t.traderStats.record })
        .from(t.traderStats)
        .where(
          and(
            inArray(t.traderStats.userId, page.map((r) => r.user.id)),
            eq(t.traderStats.period, "All"),
            eq(t.traderStats.category, "All"),
          ),
        )
    : [];
  const recordOf = new Map(seasons.map((r) => [r.userId, (r.record ?? {}) as { feesCents?: number; maxDrawdownCents?: number }]));
  const view = (stats: typeof t.traderStats.$inferSelect) => ({
    returnPct: stats.returnPct,
    correct: stats.correct,
    resolved: stats.resolved,
    trades: stats.trades,
    pnlCents: cents(stats.pnl),
    startingCapitalCents: cents(stats.startingCapital),
  });

  let you = null;
  if (viewer) {
    const [own] = await db
      .select()
      .from(t.traderStats)
      .where(and(eq(t.traderStats.userId, viewer.userId), eq(t.traderStats.period, period), eq(t.traderStats.category, "All")));
    const qualifies = !!own && (!sample || own.resolved >= MIN_SAMPLE);
    let rank: number | null = null;
    if (own && qualifies) {
      // Your place on the whole board: everyone eligible who ranks above you.
      const ownMetric = sort === "roi" ? own.returnPct : sort === "right" ? (own.resolved ? own.correct / own.resolved : null) : own.pnl;
      const [{ above }] = await db
        .select({ above: sql<number>`count(*)::int` })
        .from(t.traderStats)
        .innerJoin(t.users, eq(t.users.id, t.traderStats.userId))
        .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
        .where(
          and(
            eligible,
            sample ? gte(t.traderStats.resolved, MIN_SAMPLE) : undefined,
            ownMetric === null ? sql`${metric} is not null` : sql`(${metric} > ${ownMetric} or (${metric} = ${ownMetric} and ${t.users.id} < ${viewer.userId}))`,
          ),
        );
      const listed = await db.select({ on: t.userSettings.appearOnLeaderboard }).from(t.userSettings).where(eq(t.userSettings.userId, viewer.userId));
      rank = listed[0]?.on ? above + 1 : null;
    }
    you = { rank, stats: own ? view(own) : null, qualifies };
  }
  // When the stats job last drew this period's numbers.
  const [latest] = await db
    .select({ at: t.traderStats.computedAt })
    .from(t.traderStats)
    .where(eq(t.traderStats.period, period))
    .orderBy(desc(t.traderStats.computedAt))
    .limit(1);
  return {
    period,
    sort,
    updatedAt: latest?.at.toISOString() ?? null,
    category: query.category ?? null,
    minSample: MIN_SAMPLE,
    items: page.map((r, i) => ({
      rank: offset + i + 1,
      trader: people[i],
      stats: view(r.stats),
      record: {
        feesCents: recordOf.get(r.user.id)?.feesCents ?? 0,
        maxDrawdownCents: recordOf.get(r.user.id)?.maxDrawdownCents ?? 0,
      },
      lowSample: r.stats.resolved < MIN_SAMPLE,
    })),
    you,
    next: ranked.length > limit ? Buffer.from(String(offset + limit)).toString("base64url") : undefined,
  };
}

