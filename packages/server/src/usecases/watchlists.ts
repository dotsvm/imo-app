/**
 * Watchlists: the Saved list every account starts with (the bookmark), and
 * named lists beside it. Order is a fractional rank per item, so a drag
 * rewrites one row. `saved` addresses the default list.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { compareRanks, rankAt } from "@imo/core/rank";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import type { Viewer } from "./viewer";

export const MAX_LISTS = 20;
export const MAX_ITEMS = 500;
export const SAVED = "saved";

async function listFor(db: Db | Tx, viewer: Viewer, id: string) {
  const [list] = await db
    .select()
    .from(t.watchlists)
    .where(
      and(
        eq(t.watchlists.ownerId, viewer.userId),
        id === SAVED ? eq(t.watchlists.isDefault, true) : eq(t.watchlists.id, id),
      ),
    );
  if (!list) throw notFound("That list");
  return list;
}

async function marketId(db: Db | Tx, slug: string) {
  const [market] = await db.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.slug, slug));
  if (!market) throw notFound("That market");
  return market.id;
}

export async function listWatchlists(db: Db, viewer: Viewer) {
  const lists = await db
    .select()
    .from(t.watchlists)
    .where(eq(t.watchlists.ownerId, viewer.userId))
    .orderBy(sql`${t.watchlists.isDefault} desc`, t.watchlists.createdAt);
  const items = lists.length
    ? await db
        .select({ listId: t.watchlistItems.watchlistId, rank: t.watchlistItems.rank, slug: t.markets.slug })
        .from(t.watchlistItems)
        .innerJoin(t.markets, eq(t.markets.id, t.watchlistItems.marketId))
        .where(inArray(t.watchlistItems.watchlistId, lists.map((l) => l.id)))
    : [];
  return {
    items: lists.map((list) => ({
      id: list.id,
      name: list.name,
      isDefault: list.isDefault,
      marketIds: items
        .filter((i) => i.listId === list.id)
        .sort((a, b) => compareRanks(a.rank, b.rank))
        .map((i) => i.slug),
      updatedAt: list.updatedAt.toISOString(),
    })),
  };
}

export async function createWatchlist(db: Db, viewer: Viewer, name: string, marketSlug?: string) {
  const id = await db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t.watchlists)
      .where(eq(t.watchlists.ownerId, viewer.userId));
    if (n >= MAX_LISTS) throw invalid(`You can keep up to ${MAX_LISTS} lists.`);
    const [list] = await tx.insert(t.watchlists).values({ ownerId: viewer.userId, name }).returning();
    if (marketSlug)
      await tx.insert(t.watchlistItems).values({
        watchlistId: list.id,
        marketId: await marketId(tx, marketSlug),
        rank: rankAt([], 0),
      });
    return list.id;
  });
  return (await listWatchlists(db, viewer)).items.find((l) => l.id === id)!;
}

export async function renameWatchlist(db: Db, viewer: Viewer, id: string, name: string) {
  const list = await listFor(db, viewer, id);
  await db.update(t.watchlists).set({ name }).where(eq(t.watchlists.id, list.id));
  return (await listWatchlists(db, viewer)).items.find((l) => l.id === list.id)!;
}

export async function deleteWatchlist(db: Db, viewer: Viewer, id: string) {
  const list = await listFor(db, viewer, id);
  if (list.isDefault) throw conflict("default_list", "Your Saved list stays; empty it instead.");
  await db.delete(t.watchlists).where(eq(t.watchlists.id, list.id));
  return { deleted: true };
}

/** Add a market, or move it: at `index` in the list (the end by default). */
export async function placeMarket(db: Db, viewer: Viewer, id: string, slug: string, index?: number) {
  const list = await db.transaction(async (tx) => {
    const list = await listFor(tx, viewer, id);
    // Lock the list so two moves at once can't pick the same rank.
    await tx.select({ id: t.watchlists.id }).from(t.watchlists).where(eq(t.watchlists.id, list.id)).for("update");
    const market = await marketId(tx, slug);
    const others = await tx
      .select({ marketId: t.watchlistItems.marketId, rank: t.watchlistItems.rank })
      .from(t.watchlistItems)
      .where(eq(t.watchlistItems.watchlistId, list.id));
    const rest = others.filter((o) => o.marketId !== market);
    if (rest.length === others.length && others.length >= MAX_ITEMS)
      throw invalid(`A list holds up to ${MAX_ITEMS} markets.`);
    const rank = rankAt(rest.map((o) => o.rank), index ?? rest.length);
    await tx
      .insert(t.watchlistItems)
      .values({ watchlistId: list.id, marketId: market, rank })
      .onConflictDoUpdate({ target: [t.watchlistItems.watchlistId, t.watchlistItems.marketId], set: { rank } });
    await tx.update(t.watchlists).set({ updatedAt: new Date() }).where(eq(t.watchlists.id, list.id));
    return list;
  });
  return (await listWatchlists(db, viewer)).items.find((l) => l.id === list.id)!;
}

export async function removeMarket(db: Db, viewer: Viewer, id: string, slug: string) {
  const list = await listFor(db, viewer, id);
  const [market] = await db.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.slug, slug));
  if (market)
    await db
      .delete(t.watchlistItems)
      .where(and(eq(t.watchlistItems.watchlistId, list.id), eq(t.watchlistItems.marketId, market.id)));
  await db.update(t.watchlists).set({ updatedAt: new Date() }).where(eq(t.watchlists.id, list.id));
  return (await listWatchlists(db, viewer)).items.find((l) => l.id === list.id)!;
}
