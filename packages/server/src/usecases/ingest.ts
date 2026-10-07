/**
 * Canonical markets into Postgres. One path for every source — venue APIs,
 * the fixture venue, the demo seed — so what a screen shows never depends on
 * where a market came from.
 *
 * - Slugs are made once and never change (links stay valid).
 * - A listing whose descriptive fields are unchanged (same content hash) is
 *   skipped; prices and volumes update in bulk, apart from that.
 * - Status changes are checked against the lifecycle; an impossible jump is
 *   logged and ignored rather than trusted.
 * - A status change, and a newly final result, each write an outbox event in
 *   the same transaction; settlement listens for the result.
 * - A market that drops out of its source's listing is looked up on its own,
 *   so a result is never missed because the listing only shows open markets.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { canTransition } from "@imo/core/lifecycle";
import { headlinePrice, type Book, type CanonicalMarket } from "@imo/core/market";
import type { Clock, Logger } from "@imo/core/ports/runtime";
import type { MarketDataSource } from "@imo/venues/sdk/source";
import { categoryFor } from "../categories";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { appendEvent } from "../outbox";

export interface IngestResult {
  inserted: number;
  updated: number;
  unchanged: number;
  hidden: number;
  rejected: number;
}

const slugBase = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "") || "market";

export const slugFor = (market: CanonicalMarket) =>
  `${slugBase(market.shortTitle ?? market.title)}-${createHash("sha1")
    .update(`${market.ref.venueId}:${market.ref.externalId}`)
    .digest("hex")
    .slice(0, 6)}`;

/** Everything a listing says apart from prices and volumes. */
export const contentHash = (market: CanonicalMarket) =>
  createHash("sha1")
    .update(JSON.stringify({ ...market, stats: undefined, snapshot: undefined }))
    .digest("hex");

export async function loadCategoryMap(db: Db) {
  const rows = await db.select().from(t.categoryMap);
  return new Map(
    rows.map((r) => [
      `${r.venueId}\u0000${r.venueCategory.toLowerCase()}`,
      r.category,
    ]),
  );
}

export async function upsertMarkets(
  db: Db,
  markets: CanonicalMarket[],
  options: {
    /** The data source these markets came from. */
    source: string;
    log: Logger;
    categories?: ReadonlyMap<string, string>;
    slug?: (m: CanonicalMarket) => string;
  },
): Promise<IngestResult> {
  const result: IngestResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    hidden: 0,
    rejected: 0,
  };
  if (!markets.length) return result;
  const categories = options.categories ?? (await loadCategoryMap(db));

  const known = await db
    .select({
      venueId: t.markets.venueId,
      externalId: t.markets.externalId,
      contentHash: t.markets.contentHash,
      category: t.markets.category,
    })
    .from(t.markets)
    .where(
      inArray(
        t.markets.externalId,
        markets.map((m) => m.ref.externalId),
      ),
    );
  const hashes = new Map(
    known.map((k) => [`${k.venueId}:${k.externalId}`, k.contentHash]),
  );
  const uncategorized = new Set(
    known.filter((k) => k.category === "Uncategorized").map((k) => `${k.venueId}:${k.externalId}`),
  );

  // Markets are independent of each other: a few at a time, so a page
  // doesn't wait on a database round trip once per market in turn.
  await eachLimit(markets, UPSERT_CONCURRENCY, async (market) => {
    const hash = contentHash(market);
    const key = `${market.ref.venueId}:${market.ref.externalId}`;
    if (hashes.get(key) === hash) {
      // Nothing about it changed, but the map may have learned its tags.
      const learned = uncategorized.has(key)
        ? categoryFor(categories, market.ref.venueId, market.categoryHints)
        : null;
      if (learned) {
        await db
          .update(t.markets)
          .set({ category: learned, hidden: false })
          .where(
            and(
              eq(t.markets.venueId, market.ref.venueId),
              eq(t.markets.externalId, market.ref.externalId),
              eq(t.markets.category, "Uncategorized"),
            ),
          );
        result.updated++;
      } else result.unchanged++;
      return;
    }
    const category = categoryFor(
      categories,
      market.ref.venueId,
      market.categoryHints,
    );
    try {
      await db.transaction(async (tx) => {
        let eventId: string | undefined;
        if (market.eventRef) {
          const [event] = await tx
            .insert(t.events)
            .values({
              venueId: market.eventRef.venueId,
              externalId: market.eventRef.externalId,
              title: market.description ?? market.title,
            })
            .onConflictDoUpdate({
              target: [t.events.venueId, t.events.externalId],
              set: { title: sql`excluded.title` },
            })
            .returning({ id: t.events.id });
          eventId = event.id;
        }

        const [existing] = await tx
          .select()
          .from(t.markets)
          .where(
            and(
              eq(t.markets.venueId, market.ref.venueId),
              eq(t.markets.externalId, market.ref.externalId),
            ),
          )
          .limit(1)
          .for("update");

        const fields = {
          source: options.source,
          eventId,
          type: market.type,
          title: market.title,
          shortTitle: market.shortTitle ?? market.title,
          description: market.description ?? "",
          rules: market.rules,
          resolutionSource: market.resolutionSource ?? "",
          categoryHints: market.categoryHints,
          currency: market.currency,
          tick: market.tick,
          priceRanges: market.priceRanges ?? null,
          quantityScale: market.quantityScale,
          quantityStep: market.quantityStep,
          venueFee: market.venueFee,
          opensAt: market.opensAt ? new Date(market.opensAt) : null,
          closesAt: new Date(market.closesAt),
          expectedResolutionAt: market.expectedResolutionAt
            ? new Date(market.expectedResolutionAt)
            : null,
          // Volumes a listing leaves out keep their last known value.
          ...(market.stats?.volume !== undefined && { volume: market.stats.volume }),
          ...(market.stats?.volume24h !== undefined && {
            volume24h: market.stats.volume24h,
          }),
          ...(market.stats?.openInterest !== undefined && {
            openInterest: market.stats.openInterest,
          }),
          ...(market.stats?.liquidity !== undefined && {
            liquidity: market.stats.liquidity,
          }),
          contentHash: hash,
        };

        if (!existing) {
          const [row] = await tx
            .insert(t.markets)
            .values({
              ...fields,
              slug: (options.slug ?? slugFor)(market),
              venueId: market.ref.venueId,
              externalId: market.ref.externalId,
              category: category ?? "Uncategorized",
              hidden: !category,
              status: market.status,
              resolution: market.resolution ?? null,
            })
            .returning({ id: t.markets.id });
          await tx
            .insert(t.outcomes)
            .values(
              market.outcomes.map((o) => ({
                marketId: row.id,
                key: o.key,
                label: o.label,
                index: o.index,
                externalId: o.externalId,
              })),
            )
            .onConflictDoNothing();
          result.inserted++;
          if (!category) result.hidden++;
          return;
        }

        // Categories an admin set by hand win over the map; a market listed
        // before any of its hints mapped (hidden, "Uncategorized") takes the
        // map's category as soon as one fits.
        const next: Partial<typeof t.markets.$inferInsert> = { ...fields };
        if (category && existing.category === "Uncategorized") {
          next.category = category;
          next.hidden = false;
        }
        if (existing.status !== market.status) {
          if (canTransition(existing.status, market.status)) {
            next.status = market.status;
            await appendEvent(tx, "market.status", `market:${existing.id}`, {
              marketId: existing.id,
              from: existing.status,
              to: market.status,
            });
          } else {
            options.log.warn("impossible status change ignored", {
              market: `${market.ref.venueId}:${market.ref.externalId}`,
              from: existing.status,
              to: market.status,
            });
            result.rejected++;
          }
        }
        const becameFinal =
          !!market.resolution?.final && !existing.resolution?.final;
        if (market.resolution && !existing.resolution?.final)
          next.resolution = market.resolution;
        await tx.update(t.markets).set(next).where(eq(t.markets.id, existing.id));
        if (becameFinal)
          await appendEvent(tx, "market.resolved", `market:${existing.id}`, {
            marketId: existing.id,
            outcome: market.resolution!.outcome,
          });
        result.updated++;
      });
    } catch (error) {
      // One market the database refuses mustn't stop the rest of the page.
      const cause = (error as { cause?: { message?: string; code?: string } }).cause;
      options.log.warn("market rejected", {
        market: `${market.ref.venueId}:${market.ref.externalId}`,
        error: cause?.message ?? (error instanceof Error ? error.message : String(error)),
        code: cause?.code,
      });
      result.rejected++;
    }
  });
  return result;
}

/** How many markets of a page are written at once: well inside the pool,
    which the worker's other lanes share. */
const UPSERT_CONCURRENCY = 6;

/** Run `fn` over `items`, at most `limit` at a time. */
async function eachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const run = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const bigintOrNull = (value: number | undefined) =>
  value === undefined ? sql`null::bigint` : sql`${value}::bigint`;

/**
 * A listing's prices and volumes, in two statements for the whole page: the
 * volumes on each market (and when it was last listed), and the quote — unless
 * a fetched book refreshed it in the last 15 seconds, which is fresher.
 */
export async function applySnapshots(
  db: Db,
  markets: CanonicalMarket[],
  source: string,
  now: Date,
) {
  if (!markets.length) return 0;
  const at = now.toISOString();
  const values = sql.join(
    markets.map(
      (m) =>
        sql`(${m.ref.venueId}, ${m.ref.externalId}, ${bigintOrNull(m.stats?.volume)}, ${bigintOrNull(m.stats?.volume24h)}, ${bigintOrNull(m.stats?.openInterest)}, ${bigintOrNull(m.stats?.liquidity)})`,
    ),
    sql`, `,
  );
  const rows = await db.execute<{
    id: string;
    venue_id: string;
    external_id: string;
  }>(sql`
    update markets m set
      volume = coalesce(v.volume, m.volume),
      volume24h = coalesce(v.volume24h, m.volume24h),
      open_interest = coalesce(v.open_interest, m.open_interest),
      liquidity = coalesce(v.liquidity, m.liquidity),
      seen_at = ${at}::timestamptz
    from (values ${values}) as v(venue_id, external_id, volume, volume24h, open_interest, liquidity)
    where m.venue_id = v.venue_id and m.external_id = v.external_id
    returning m.id, m.venue_id, m.external_id`);
  const idOf = new Map(
    rows.map((r) => [`${r.venue_id}:${r.external_id}`, r.id]),
  );

  const quotes = markets.flatMap((m) => {
    const id = idOf.get(`${m.ref.venueId}:${m.ref.externalId}`);
    const s = m.snapshot;
    if (!id || !s) return [];
    const last = headlinePrice({
      bid: s.yesBid,
      ask: s.yesAsk,
      lastTrade: s.last,
    });
    if (last === undefined) return [];
    return [
      sql`(${id}::uuid, ${bigintOrNull(s.yesBid)}, ${bigintOrNull(s.yesAsk)}, ${last}::bigint, ${bigintOrNull(s.change24h)})`,
    ];
  });
  if (quotes.length)
    await db.execute(sql`
      insert into market_quotes (market_id, yes_bid, yes_ask, last, change24h, source, updated_at)
      select v.market_id, v.yes_bid, v.yes_ask, v.last, coalesce(v.change24h, 0), ${source}, ${at}::timestamptz
      from (values ${sql.join(quotes, sql`, `)}) as v(market_id, yes_bid, yes_ask, last, change24h)
      on conflict (market_id) do update set
        yes_bid = excluded.yes_bid,
        yes_ask = excluded.yes_ask,
        last = excluded.last,
        change24h = case when excluded.change24h <> 0 then excluded.change24h else market_quotes.change24h end,
        source = excluded.source,
        updated_at = excluded.updated_at
      where market_quotes.updated_at < excluded.updated_at - interval '15 seconds'`);
  return rows.length;
}

/** Top of a fetched book → the market's quote row. Returns the markets whose
    quote changed. */
export async function upsertQuotes(
  db: Db,
  books: Book[],
  source: string,
  now: Date,
) {
  if (!books.length) return [];
  const rows = await db
    .select({
      id: t.markets.id,
      venueId: t.markets.venueId,
      externalId: t.markets.externalId,
      quote: t.marketQuotes,
    })
    .from(t.markets)
    .leftJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .where(
      inArray(
        t.markets.externalId,
        books.map((b) => b.ref.externalId),
      ),
    );
  const byRef = new Map(rows.map((r) => [`${r.venueId}:${r.externalId}`, r]));
  const changed: string[] = [];
  for (const book of books) {
    const row = byRef.get(`${book.ref.venueId}:${book.ref.externalId}`);
    if (!row) continue;
    const yes = book.outcomes.find((o) => o.outcome === "yes");
    const bid = yes?.bids[0]?.price ?? null;
    const ask = yes?.asks[0]?.price ?? null;
    const last =
      headlinePrice({ bid, ask, lastTrade: row.quote?.last }) ?? null;
    if (
      row.quote &&
      row.quote.yesBid === bid &&
      row.quote.yesAsk === ask &&
      row.quote.last === last
    )
      continue;
    await db
      .insert(t.marketQuotes)
      .values({ marketId: row.id, yesBid: bid, yesAsk: ask, last, source, updatedAt: now })
      .onConflictDoUpdate({
        target: t.marketQuotes.marketId,
        set: { yesBid: bid, yesAsk: ask, last, source, updatedAt: now },
      });
    changed.push(row.id);
  }
  return changed;
}

const SETTLED = ["resolved", "voided", "delisted"] as const;

export interface SyncDeps {
  clock: Clock;
  log: Logger;
  venues: { sources: ReadonlyMap<string, MarketDataSource> };
}

/**
 * One pass over a source's listing: every page upserted, prices and volumes
 * applied, then the markets that weren't listed looked up one by one.
 */
export async function syncCatalog(
  deps: SyncDeps,
  db: Db,
  sourceId: string,
  options: { maxPages?: number; reconcile?: number } = {},
) {
  const source = deps.venues.sources.get(sourceId);
  if (!source) throw new Error(`No data source ${sourceId}`);
  const log = deps.log.child({ source: sourceId });
  const started = deps.clock.now();
  const categories = await loadCategoryMap(db);
  const totals: IngestResult & { listed: number } = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    hidden: 0,
    rejected: 0,
    listed: 0,
  };
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await source.listMarkets(cursor);
    const result = await upsertMarkets(db, page.items, {
      source: sourceId,
      log,
      categories,
    });
    await applySnapshots(db, page.items, sourceId, deps.clock.now());
    for (const key of Object.keys(result) as (keyof IngestResult)[])
      totals[key] += result[key];
    totals.listed += page.items.length;
    cursor = page.next;
    pages++;
  } while (cursor && pages < (options.maxPages ?? 200));

  const complete = !cursor;
  // Only a full pass says what's missing from the listing.
  const reconciled = complete
    ? await reconcileUnlisted(
        deps,
        db,
        sourceId,
        source,
        started,
        options.reconcile ?? 100,
      )
    : 0;
  return { ...totals, pages, complete, reconciled };
}

/** Markets this source stopped listing, looked up individually — the ones
    people hold first. A market the venue no longer knows is delisted. */
async function reconcileUnlisted(
  deps: SyncDeps,
  db: Db,
  sourceId: string,
  source: MarketDataSource,
  listedSince: Date,
  limit: number,
) {
  const stale = await db
    .select({
      id: t.markets.id,
      venueId: t.markets.venueId,
      externalId: t.markets.externalId,
      status: t.markets.status,
    })
    .from(t.markets)
    .where(
      and(
        eq(t.markets.source, sourceId),
        notInArray(t.markets.status, [...SETTLED]),
        or(isNull(t.markets.seenAt), lt(t.markets.seenAt, listedSince)),
      ),
    )
    .orderBy(
      sql`exists (select 1 from positions p where p.market_id = ${t.markets.id}) desc`,
      asc(t.markets.closesAt),
    )
    .limit(limit);
  const log = deps.log.child({ source: sourceId });
  let looked = 0;
  for (const row of stale) {
    const market = await source.getMarket({
      venueId: row.venueId,
      externalId: row.externalId,
    });
    looked++;
    if (market) {
      await upsertMarkets(db, [market], { source: sourceId, log });
      await applySnapshots(db, [market], sourceId, deps.clock.now());
      continue;
    }
    if (!canTransition(row.status, "delisted")) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(t.markets)
        .set({ status: "delisted", seenAt: deps.clock.now() })
        .where(eq(t.markets.id, row.id));
      await appendEvent(tx, "market.status", `market:${row.id}`, {
        marketId: row.id,
        from: row.status,
        to: "delisted",
      });
    });
    log.warn("market delisted by its venue", { market: row.externalId });
  }
  return looked;
}
