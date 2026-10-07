/**
 * Price alerts: "tell me when Yes crosses 60¢". Checked by the worker against
 * the quote cache; each fires once, then rests until set again.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { cents, micros } from "../dto/money";
import { invalid, notFound } from "../errors";
import type { NotificationInput } from "./notifications";
import type { Viewer } from "./viewer";

export const MAX_ALERTS = 50;
const ONE = 1_000_000;

const view = (row: typeof t.priceAlerts.$inferSelect, slug: string) => ({
  id: row.id,
  marketId: slug,
  outcome: row.outcome === "yes" ? ("Yes" as const) : ("No" as const),
  thresholdCents: cents(row.threshold),
  direction: row.direction,
  active: row.active,
  triggeredAt: row.triggeredAt?.toISOString() ?? null,
});

export async function listAlerts(db: Db, viewer: Viewer) {
  const rows = await db
    .select({ alert: t.priceAlerts, slug: t.markets.slug })
    .from(t.priceAlerts)
    .innerJoin(t.markets, eq(t.markets.id, t.priceAlerts.marketId))
    .where(eq(t.priceAlerts.userId, viewer.userId))
    .orderBy(asc(t.priceAlerts.createdAt));
  return { items: rows.map((r) => view(r.alert, r.slug)) };
}

export async function createAlert(
  db: Db,
  viewer: Viewer,
  input: { market: string; outcome: "Yes" | "No"; thresholdCents: number; direction: "above" | "below" },
) {
  const [market] = await db.select({ id: t.markets.id, slug: t.markets.slug }).from(t.markets).where(eq(t.markets.slug, input.market));
  if (!market) throw notFound("That market");
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.priceAlerts)
    .where(and(eq(t.priceAlerts.userId, viewer.userId), eq(t.priceAlerts.active, true)));
  if (n >= MAX_ALERTS) throw invalid(`You can keep up to ${MAX_ALERTS} alerts.`);
  const [row] = await db
    .insert(t.priceAlerts)
    .values({
      userId: viewer.userId,
      marketId: market.id,
      outcome: input.outcome === "Yes" ? "yes" : "no",
      threshold: micros(input.thresholdCents),
      direction: input.direction,
    })
    .returning();
  return view(row, market.slug);
}

export async function deleteAlert(db: Db, viewer: Viewer, id: string) {
  const deleted = await db
    .delete(t.priceAlerts)
    .where(and(eq(t.priceAlerts.id, id), eq(t.priceAlerts.userId, viewer.userId)))
    .returning({ id: t.priceAlerts.id });
  if (!deleted.length) throw notFound("That alert");
  return { deleted: true };
}

/** Alerts whose price has been crossed, marked fired, as notifications. */
export async function fireAlerts(db: Db, now: Date): Promise<NotificationInput[]> {
  // Crossings are decided in SQL so no alert is read twice by two replicas.
  const fired = await db.execute<{
    id: string;
    user_id: string;
    outcome: string;
    threshold: number;
    direction: string;
    price: number;
    change: number;
    slug: string;
    title: string;
  }>(sql`
    update price_alerts a set active = false, triggered_at = ${now.toISOString()}::timestamptz
    from market_quotes q, markets m
    where a.active and q.market_id = a.market_id and m.id = a.market_id and q.last is not null
      and m.status in ('open', 'paused')
      and case when a.direction = 'above'
        then (case when a.outcome = 'yes' then q.last else ${ONE} - q.last end) >= a.threshold
        else (case when a.outcome = 'yes' then q.last else ${ONE} - q.last end) <= a.threshold end
    returning a.id, a.user_id, a.outcome, a.threshold, a.direction,
      (case when a.outcome = 'yes' then q.last else ${ONE} - q.last end) as price,
      (case when a.outcome = 'yes' then q.change24h else -q.change24h end) as change,
      m.slug, m.short_title as title`);
  return fired.map((a) => {
    const outcome = a.outcome === "yes" ? "Yes" : "No";
    const moved = Math.round(Number(a.change) / 10_000);
    return {
      userId: a.user_id,
      kind: "Price" as const,
      preference: "alerts",
      icon: "price",
      title: `${a.title} crossed ${cents(Number(a.threshold))}¢`,
      body: `${outcome} is trading at ${Math.round(cents(Number(a.price)))}¢, ${moved >= 0 ? "up" : "down"} ${Math.abs(moved)} ${Math.abs(moved) === 1 ? "point" : "points"} over 24 hours.`,
      href: `/market/${a.slug}`,
      dedupeKey: `alert:${a.id}:${now.toISOString()}`,
      at: now,
    };
  });
}

/** Holders of markets that close within a day, told once per market. */
export async function closingSoon(db: Db, now: Date): Promise<NotificationInput[]> {
  const soon = new Date(now.getTime() + 86_400_000);
  const rows = await db
    .select({
      userId: t.tradingAccounts.userId,
      slug: t.markets.slug,
      title: t.markets.shortTitle,
      closesAt: t.markets.closesAt,
      outcome: t.positions.outcome,
      quantity: t.positions.quantity,
      scale: t.markets.quantityScale,
      marketId: t.markets.id,
    })
    .from(t.positions)
    .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.id, t.positions.accountId))
    .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
    .where(and(inArray(t.markets.status, ["open", "paused"]), lte(t.markets.closesAt, soon), sql`${t.markets.closesAt} > ${now.toISOString()}::timestamptz`));
  return rows.map((r) => ({
    userId: r.userId,
    kind: "Resolution" as const,
    preference: "closing",
    icon: "resolved",
    title: `${r.title} closes within a day`,
    body: `You hold ${r.quantity / 10 ** r.scale} ${r.outcome === "yes" ? "Yes" : "No"}. Trading stops ${r.closesAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC.`,
    href: `/market/${r.slug}`,
    dedupeKey: `closing:${r.marketId}:${r.outcome}`,
    at: now,
  }));
}
