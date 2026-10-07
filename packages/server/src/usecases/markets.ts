/**
 * Markets for screens: the catalog with filters, sorts and pages; one market;
 * its live book, tape and history from the data source that feeds it.
 * Responses are shaped like the UI's Market records (cents), so screens move
 * onto the API without reshaping.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { complement, type Book, type Candle } from "@imo/core/market";
import type { Deps } from "../composition";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { DESIGN_SNAPSHOT, DESIGN_SOURCE } from "../demo/design-source";
import { cents } from "../dto/money";
import { notFound } from "../errors";
import { traderSummaries } from "./people";

export const MARKET_SORTS = [
  "trending",
  "movers",
  "volume",
  "closing",
  "new",
] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

export interface MarketQuery {
  category?: string;
  venue?: string;
  status?: "open" | "soon" | "closed" | "resolved" | "all";
  sort?: MarketSort;
  q?: string;
  /** Market slugs, for fetching a known set (positions, posts, lists). */
  ids?: string[];
  /** Only markets an admin featured. */
  featured?: boolean;
  minCents?: number;
  maxCents?: number;
  limit?: number;
  cursor?: string;
}

type Row = typeof t.markets.$inferSelect & {
  quote: typeof t.marketQuotes.$inferSelect | null;
  holders: typeof t.marketHolders.$inferSelect | null;
};

/** The UI's three market states; paused markets stay open with a flag. */
const viewStatus = (status: string): "open" | "closed" | "resolved" =>
  status === "resolved" || status === "voided"
    ? "resolved"
    : status === "open" || status === "paused" || status === "upcoming"
      ? "open"
      : "closed";

export function toMarketDTO(row: Row) {
  const outcome = row.resolution?.outcome;
  return {
    id: row.slug,
    venueId: row.venueId,
    venueContractId: row.externalId,
    venueFee: row.venueFee,
    title: row.title,
    shortTitle: row.shortTitle,
    category: row.category,
    asset: row.category,
    yesPrice: row.quote?.last != null ? cents(row.quote.last) : 50,
    yesBid: row.quote?.yesBid != null ? cents(row.quote.yesBid) : null,
    yesAsk: row.quote?.yesAsk != null ? cents(row.quote.yesAsk) : null,
    change: row.quote ? cents(row.quote.change24h) : 0,
    volumeCents: cents(row.volume),
    liquidityCents: cents(row.liquidity),
    openInterestCents: cents(row.openInterest),
    closesAt: row.closesAt.toISOString(),
    status: viewStatus(row.status),
    /** The canonical lifecycle state, for screens that show more detail. */
    lifecycle: row.status,
    paused: row.status === "paused",
    resolution: {
      rule: row.rules,
      source: row.resolutionSource,
      ...(outcome === "yes" || outcome === "no"
        ? { outcome: outcome === "yes" ? ("Yes" as const) : ("No" as const) }
        : {}),
      ...(outcome === "void" ? { void: true } : {}),
      final: row.resolution?.final ?? false,
    },
    description: row.description,
    series: (row.quote?.series ?? []).map(cents),
    traders: row.traders,
    holders: { yes: row.holders?.yes ?? 0, no: row.holders?.no ?? 0 },
    quoteUpdatedAt: row.quote?.updatedAt.toISOString() ?? null,
    featured: row.featured,
    featuredLabel: row.featuredLabel,
  };
}
export type MarketDTO = ReturnType<typeof toMarketDTO>;

const encodeCursor = (offset: number) =>
  Buffer.from(String(offset)).toString("base64url");
const decodeCursor = (cursor?: string) => {
  const n = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

async function query(
  db: Db,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
  offset: number,
) {
  const rows = await db
    .select({
      market: t.markets,
      quote: t.marketQuotes,
      holders: t.marketHolders,
    })
    .from(t.markets)
    .leftJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .leftJoin(t.marketHolders, eq(t.marketHolders.marketId, t.markets.id))
    .leftJoin(t.marketTrending, eq(t.marketTrending.marketId, t.markets.id))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...r.market, quote: r.quote, holders: r.holders }));
}

export async function listMarkets(db: Db, q: MarketQuery, now: Date) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  const offset = decodeCursor(q.cursor);
  const filters: (SQL | undefined)[] = [eq(t.markets.hidden, false)];
  if (q.ids?.length) filters.push(inArray(t.markets.slug, q.ids));
  if (q.featured) filters.push(eq(t.markets.featured, true));
  if (q.category && q.category !== "All")
    filters.push(eq(t.markets.category, q.category));
  if (q.venue && q.venue !== "All")
    filters.push(eq(t.markets.venueId, q.venue));
  const status = q.status ?? (q.ids?.length ? "all" : "open");
  // A listing never shows an open market the venue hasn't priced; asking
  // for markets by id always answers.
  if (!q.ids?.length)
    filters.push(
      sql`(${t.markets.status} not in ('open', 'paused') or ${t.marketQuotes.last} is not null)`,
    );
  if (status === "open")
    filters.push(inArray(t.markets.status, ["open", "paused"]));
  if (status === "soon")
    filters.push(
      inArray(t.markets.status, ["open", "paused"]),
      lte(t.markets.closesAt, new Date(now.getTime() + 7 * 86_400_000)),
    );
  if (status === "closed")
    filters.push(
      inArray(t.markets.status, ["closed", "determined", "disputed"]),
    );
  if (status === "resolved")
    filters.push(inArray(t.markets.status, ["resolved", "voided"]));
  if (q.minCents !== undefined)
    filters.push(gte(t.marketQuotes.last, q.minCents * 10_000));
  if (q.maxCents !== undefined)
    filters.push(lte(t.marketQuotes.last, q.maxCents * 10_000));
  const text = q.q?.trim();
  if (text)
    filters.push(
      or(
        ilike(t.markets.title, `%${text}%`),
        ilike(t.markets.shortTitle, `%${text}%`),
      ),
    );

  const order: SQL[] =
    q.sort === "volume"
      ? [desc(t.markets.volume)]
      : q.sort === "closing"
        ? [asc(t.markets.closesAt)]
        : q.sort === "new"
          ? [desc(t.markets.createdAt)]
          : q.sort === "movers"
            ? [sql`abs(coalesce(${t.marketQuotes.change24h}, 0)) desc`]
            : [
                sql`${t.marketTrending.rank} asc nulls last`,
                desc(t.markets.volume),
              ];
  if (text) order.unshift(sql`similarity(${t.markets.title}, ${text}) desc`);
  order.push(asc(t.markets.id));

  const rows = await query(db, and(...filters), order, limit + 1, offset);
  const items = rows.slice(0, limit).map(toMarketDTO);
  // Keep the order a caller asked for when fetching by ids.
  if (q.ids?.length)
    items.sort((a, b) => q.ids!.indexOf(a.id) - q.ids!.indexOf(b.id));
  return {
    items,
    next: rows.length > limit ? encodeCursor(offset + limit) : undefined,
  };
}

export async function marketRow(db: Db, slug: string) {
  const [row] = await query(
    db,
    eq(t.markets.slug, slug),
    [asc(t.markets.id)],
    1,
    0,
  );
  if (!row) throw notFound("That market");
  return row;
}

export async function getMarket(db: Db, slug: string) {
  return toMarketDTO(await marketRow(db, slug));
}

/** Design markets describe a fixed moment; live ones describe now. */
const dataNow = (source: string, clock: Deps["clock"]) =>
  source === DESIGN_SOURCE ? new Date(DESIGN_SNAPSHOT) : clock.now();

function sourceOf(deps: Pick<Deps, "venues">, row: { source: string }) {
  return deps.venues.sources.get(row.source);
}

/** The Yes book as the ticket's depth ladder: price, shares and a bar width. */
export function bookView(
  book: Book | undefined,
  market: { slug: string; quantityScale: number },
  fallbackAt: string | null = null,
) {
  const yes = book?.outcomes.find((o) => o.outcome === "yes");
  const scale = 10 ** market.quantityScale;
  const bids = (yes?.bids ?? []).slice(0, 8);
  const asks = (yes?.asks ?? []).slice(0, 8);
  const deepest = Math.max(
    1,
    ...bids.map((l) => l.quantity),
    ...asks.map((l) => l.quantity),
  );
  const level = (l: { price: number; quantity: number }) => ({
    priceCents: cents(l.price),
    shares: l.quantity / scale,
    depthPercent: Math.max(1, Math.round((l.quantity / deepest) * 100)),
  });
  return {
    marketId: market.slug,
    bids: bids.map(level),
    asks: asks.map(level),
    at: book?.at ?? fallbackAt,
    live: !!book,
  };
}

export async function marketBook(
  deps: Pick<Deps, "venues">,
  db: Db,
  slug: string,
) {
  const row = await marketRow(db, slug);
  const source = sourceOf(deps, row);
  const [book] = source
    ? await source.getBooks([
        { venueId: row.venueId, externalId: row.externalId },
      ])
    : [];
  return bookView(book, row, row.quote?.updatedAt.toISOString() ?? null);
}

/** The tape is shared by everyone watching a market: one venue call per
    market this often, however many are looking. */
const TRADES_TTL_SECONDS = 10;

export async function marketTrades(
  deps: Pick<Deps, "venues" | "clock" | "cache">,
  db: Db,
  slug: string,
) {
  const row = await marketRow(db, slug);
  const source = sourceOf(deps, row);
  if (!source?.getTrades) return { items: [] };
  const key = `trades:${row.id}`;
  let tape = await deps.cache.get<TapeTrade[]>(key);
  if (!tape) {
    const trades = await source.getTrades({
      venueId: row.venueId,
      externalId: row.externalId,
    });
    const scale = 10 ** row.quantityScale;
    tape = trades.slice(0, 50).map((trade, i) => {
      const outcome =
        trade.side === "sell" ? ("No" as const) : ("Yes" as const);
      const yes = cents(trade.price);
      return {
        id: `${row.slug}-trade-${i}`,
        side: "Buy" as const,
        outcome,
        priceCents: outcome === "Yes" ? yes : complement(yes),
        shares: trade.quantity / scale,
        at: trade.at,
      };
    });
    await deps.cache.set(key, tape, TRADES_TTL_SECONDS);
  }
  const now = dataNow(row.source, deps.clock).getTime();
  return {
    items: tape.map((trade) => ({
      ...trade,
      minutesAgo: Math.max(0, Math.round((now - Date.parse(trade.at)) / 60_000)),
    })),
  };
}

type TapeTrade = {
  id: string;
  side: "Buy";
  outcome: "Yes" | "No";
  priceCents: number;
  shares: number;
  /** When it traded, as the venue reports it. */
  at: string;
};

const RANGES = { "1D": 1, "1W": 7, "1M": 30, All: 365 } as const;
export type CandleRangeKey = keyof typeof RANGES;

/** How long a range's history is reused: a chart needn't be live, and each
    fresh one costs a call to the venue. */
const CANDLES_TTL_SECONDS: Record<CandleRangeKey, number> = {
  "1D": 60,
  "1W": 300,
  "1M": 900,
  All: 1_800,
};

export async function marketCandles(
  deps: Pick<Deps, "venues" | "clock" | "cache">,
  db: Db,
  slug: string,
  range: CandleRangeKey,
) {
  const row = await marketRow(db, slug);
  const key = `candles:${row.id}:${range}`;
  const cached = await deps.cache.get<CandlesPage>(key);
  if (cached) return cached;
  const page = await freshCandles(deps, row, range);
  // An empty history may just be a venue hiccup: ask again next time.
  if (page.points.length) await deps.cache.set(key, page, CANDLES_TTL_SECONDS[range]);
  return page;
}

type CandlesPage = { marketId: string; range: CandleRangeKey; points: { t: string; yes: number }[] };

async function freshCandles(
  deps: Pick<Deps, "venues" | "clock">,
  row: Awaited<ReturnType<typeof marketRow>>,
  range: CandleRangeKey,
): Promise<CandlesPage> {
  const source = sourceOf(deps, row);
  const to = dataNow(row.source, deps.clock);
  const from = new Date(to.getTime() - RANGES[range] * 86_400_000);
  let candles: Candle[] = [];
  if (source?.getCandles)
    candles = await source.getCandles(
      { venueId: row.venueId, externalId: row.externalId },
      {
        interval: range === "1D" ? "1h" : range === "All" ? "1d" : "1h",
        from: from.toISOString(),
        to: to.toISOString(),
      },
    );
  return {
    marketId: row.slug,
    range,
    points: candles.map((c) => ({ t: c.start, yes: cents(c.close) })),
  };
}

export async function relatedMarkets(db: Db, slug: string, now: Date) {
  const row = await marketRow(db, slug);
  const { items } = await listMarkets(
    db,
    { category: row.category, sort: "volume", limit: 6 },
    now,
  );
  return { items: items.filter((m) => m.id !== slug).slice(0, 5) };
}

/**
 * Who holds a market on Hunch, biggest first on each side — people who keep
 * their positions private stay out (you always see your own).
 */
export async function marketHolders(db: Db, viewer: { userId: string } | null, slug: string, limit = 20) {
  const row = await marketRow(db, slug);
  const scale = 10 ** row.quantityScale;
  const rows = await db
    .select({ user: t.users, outcome: t.positions.outcome, quantity: t.positions.quantity })
    .from(t.positions)
    .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.id, t.positions.accountId))
    .innerJoin(t.users, eq(t.users.id, t.tradingAccounts.userId))
    .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .where(
      and(
        eq(t.positions.marketId, row.id),
        sql`${t.users.deletedAt} is null`,
        viewer
          ? or(eq(t.userSettings.privateOpenPositions, false), eq(t.users.id, viewer.userId))
          : eq(t.userSettings.privateOpenPositions, false),
      ),
    )
    .orderBy(desc(t.positions.quantity))
    .limit(limit * 2);
  const people = await traderSummaries(db, viewer as Parameters<typeof traderSummaries>[1], rows.map((r) => r.user));
  return {
    marketId: row.slug,
    holders: rows.map((r, i) => ({
      trader: people[i],
      outcome: r.outcome === "yes" ? ("Yes" as const) : ("No" as const),
      shares: r.quantity / scale,
    })),
  };
}
