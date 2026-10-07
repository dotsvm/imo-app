/**
 * Keeping prices current. Listings give every market a quote every few
 * minutes; markets someone is looking at, or has a resting order in, get
 * their book every few seconds — the quote row updates, viewers get the change
 * over realtime, and resting orders are matched against it.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { channels } from "@imo/core/ports/platform";
import type { Book } from "@imo/core/market";
import type { Deps } from "../composition";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { DESIGN_SOURCE } from "../demo/design-source";
import { cents } from "../dto/money";
import { upsertQuotes } from "./ingest";
import { bookView } from "./markets";
import { matchRestingOrders } from "./trading";

/** How long a view keeps a market hot. */
export const INTEREST_MS = 2 * 60_000;
const TOUCH_EVERY_MS = 30_000;
const BOOK_BATCH = 50;
const HOT_LIMIT = 500;
/** Points in a card's 7-day sparkline, as the design draws it. */
export const SERIES_POINTS = 36;

const touched = new Map<string, number>();

/** Someone opened this market: keep its book fresh for a while. */
export async function touchInterest(db: Db, slug: string, now: Date) {
  const last = touched.get(slug);
  if (last !== undefined && now.getTime() - last < TOUCH_EVERY_MS) return;
  if (touched.size > 10_000) touched.clear();
  touched.set(slug, now.getTime());
  const until = new Date(now.getTime() + INTEREST_MS).toISOString();
  await db.execute(sql`
    insert into market_interest (market_id, until)
    select id, ${until}::timestamptz from markets where slug = ${slug}
    on conflict (market_id) do update set until = excluded.until`);
}

type HotDeps = Pick<Deps, "venues" | "realtime" | "clock" | "log">;

/** Last book published per market, so an unchanged book isn't re-sent. */
const published = new Map<string, string>();
const digest = (book: Book) =>
  JSON.stringify(
    book.outcomes
      .find((o) => o.outcome === "yes")
      ?.bids.slice(0, 8)
      .concat(book.outcomes.find((o) => o.outcome === "yes")?.asks.slice(0, 8) ?? []),
  );

export async function refreshHotMarkets(deps: HotDeps, db: Db, now: Date) {
  const at = now.toISOString();
  const hot = await db
    .select()
    .from(t.markets)
    .where(
      and(
        eq(t.markets.status, "open"),
        sql`(exists (select 1 from market_interest i where i.market_id = ${t.markets.id} and i.until > ${at}::timestamptz)
          or exists (select 1 from orders o where o.market_id = ${t.markets.id} and o.status in ('open', 'partial')))`,
      ),
    )
    .limit(HOT_LIMIT);
  const bySource = new Map<string, typeof hot>();
  for (const market of hot)
    bySource.set(market.source, [...(bySource.get(market.source) ?? []), market]);

  let books = 0;
  let changed = 0;
  let fills = 0;
  for (const [sourceId, markets] of bySource) {
    const source = deps.venues.sources.get(sourceId);
    if (!source) continue;
    for (let i = 0; i < markets.length; i += BOOK_BATCH) {
      const batch = markets.slice(i, i + BOOK_BATCH);
      let fetched: Book[];
      try {
        fetched = await source.getBooks(batch.map((m) => ({ venueId: m.venueId, externalId: m.externalId })));
      } catch (error) {
        deps.log.warn("hot books failed", {
          source: sourceId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      books += fetched.length;
      // The design dataset is a fixed snapshot: its seeded quotes stand.
      const moved =
        sourceId === DESIGN_SOURCE ? [] : await upsertQuotes(db, fetched, sourceId, now);
      changed += moved.length;
      const byRef = new Map(batch.map((m) => [`${m.venueId}:${m.externalId}`, m]));
      const quotes = moved.length
        ? await db.select().from(t.marketQuotes).where(inArray(t.marketQuotes.marketId, moved))
        : [];
      for (const book of fetched) {
        const market = byRef.get(`${book.ref.venueId}:${book.ref.externalId}`);
        if (!market) continue;
        const quote = quotes.find((q) => q.marketId === market.id);
        if (quote)
          await deps.realtime.publish(channels.market(market.slug), "quote", {
            yesBidCents: quote.yesBid !== null ? cents(quote.yesBid) : null,
            yesAskCents: quote.yesAsk !== null ? cents(quote.yesAsk) : null,
            yesPriceCents: quote.last !== null ? cents(quote.last) : null,
            at,
          });
        const d = digest(book);
        if (published.get(market.id) !== d) {
          published.set(market.id, d);
          await deps.realtime.publish(channels.market(market.slug), "book", bookView(book, market));
        }
        fills += (await matchRestingOrders(deps, db, market, book)).fills;
      }
    }
  }
  if (published.size > 5_000) published.clear();
  return { markets: hot.length, books, changed, fills };
}

/** Evenly spaced points from a series, always keeping the latest. */
export function downsample(values: number[], points: number) {
  if (values.length <= points) return values;
  const step = (values.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, i) => values[Math.round(i * step)]);
}

/**
 * The 7-day sparkline for the markets people see most: hourly candles,
 * thinned to the card's 36 points. Also fills the 24-hour change for sources
 * whose listings don't report one.
 */
export async function refreshSeries(
  deps: Pick<Deps, "venues" | "log">,
  db: Db,
  sourceId: string,
  now: Date,
  limit = 150,
) {
  const source = deps.venues.sources.get(sourceId);
  if (!source?.getCandles) return { refreshed: 0 };
  const rows = await db
    .select({ market: t.markets, quote: t.marketQuotes })
    .from(t.markets)
    .innerJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .leftJoin(t.marketTrending, eq(t.marketTrending.marketId, t.markets.id))
    .where(and(eq(t.markets.source, sourceId), eq(t.markets.status, "open"), eq(t.markets.hidden, false)))
    .orderBy(asc(sql`coalesce(${t.marketTrending.rank}, 2147483647)`), desc(t.markets.volume24h))
    .limit(limit);
  const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  let refreshed = 0;
  for (const { market, quote } of rows) {
    try {
      const candles = await source.getCandles(
        { venueId: market.venueId, externalId: market.externalId },
        { interval: "1h", from, to: now.toISOString() },
      );
      if (!candles.length) continue;
      const closes = candles.map((c) => c.close);
      const series = downsample(closes, SERIES_POINTS);
      const dayAgo = candles.findLast((c) => Date.parse(c.start) <= now.getTime() - 86_400_000);
      const change =
        quote.change24h === 0 && dayAgo && quote.last !== null ? quote.last - dayAgo.close : quote.change24h;
      await db
        .update(t.marketQuotes)
        .set({ series, change24h: change })
        .where(eq(t.marketQuotes.marketId, market.id));
      refreshed++;
    } catch (error) {
      deps.log.warn("series refresh failed", {
        market: market.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { refreshed };
}

/** Each venue's trading status from its source, for banners and for the
    ticket to refuse orders while a venue is paused. */
export async function refreshVenueStatus(
  deps: Pick<Deps, "venues">,
  db: Db,
  sourceId: string,
) {
  const source = deps.venues.sources.get(sourceId);
  if (!source) return { venues: 0 };
  const status = await source.status();
  const venues = await db
    .selectDistinct({ venueId: t.markets.venueId })
    .from(t.markets)
    .where(eq(t.markets.source, sourceId));
  for (const { venueId } of venues) {
    const row = {
      exchangeActive: status.exchangeActive,
      tradingActive: status.tradingActive,
      resumesAt: status.resumesAt ? new Date(status.resumesAt) : null,
      checkedAt: new Date(status.checkedAt),
    };
    await db
      .insert(t.venueStatus)
      .values({ venueId, ...row })
      .onConflictDoUpdate({ target: t.venueStatus.venueId, set: row });
  }
  return { venues: venues.length, tradingActive: status.tradingActive };
}

/**
 * Trending for live markets: 24-hour volume, depth, Hunch's own activity and
 * holders, and how far the price moved. The design dataset keeps its curated
 * order; ranks are then numbered across everything.
 */
export async function computeTrending(db: Db, now: Date) {
  const at = now.toISOString();
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  await db.execute(sql`
    insert into market_trending (market_id, score, rank, computed_at)
    select m.id,
      ln(1 + m.volume24h / 1e6) * 1.0
      + ln(1 + m.liquidity / 1e6) * 0.3
      + ln(1 + coalesce(a.orders, 0)) * 1.5
      + ln(1 + coalesce(h.yes + h.no, 0)) * 0.5
      -- The day's move counts on a log scale like volume: a small market
      -- swinging to its result shouldn't outrank one trading millions.
      + ln(1 + abs(coalesce(q.change24h, 0)) / 10000.0) * 1.0
      + case when m.featured then 5 else 0 end,
      0, ${at}::timestamptz
    from markets m
    left join (select market_id, count(*) as orders from orders
               where created_at > ${since}::timestamptz group by market_id) a on a.market_id = m.id
    left join market_holders h on h.market_id = m.id
    left join market_quotes q on q.market_id = m.id
    where m.status = 'open' and not m.hidden and m.source <> ${DESIGN_SOURCE}
    on conflict (market_id) do update set score = excluded.score, computed_at = excluded.computed_at`);
  await db.execute(sql`
    delete from market_trending tr using markets m
    where tr.market_id = m.id and m.source <> ${DESIGN_SOURCE} and (m.status <> 'open' or m.hidden)`);
  const ranked = await db.execute(sql`
    update market_trending tr set rank = r.rn
    from (select market_id, row_number() over (order by score desc, market_id) as rn from market_trending) r
    where tr.market_id = r.market_id and tr.rank <> r.rn`);
  return { ranked: ranked.count ?? 0 };
}

/** Hunch's own holders per side, for live markets (the design seeds its own). */
export async function refreshHolders(db: Db) {
  await db.execute(sql`
    insert into market_holders (market_id, yes, no, yes_share)
    select p.market_id,
      count(distinct p.account_id) filter (where p.outcome = 'yes'),
      count(distinct p.account_id) filter (where p.outcome = 'no'),
      coalesce(count(distinct p.account_id) filter (where p.outcome = 'yes')::real
        / nullif(count(distinct p.account_id), 0), 0)
    from positions p join markets m on m.id = p.market_id
    where m.source <> ${DESIGN_SOURCE}
    group by p.market_id
    on conflict (market_id) do update set yes = excluded.yes, no = excluded.no, yes_share = excluded.yes_share`);
  await db
    .delete(t.marketHolders)
    .where(
      and(
        inArray(
          t.marketHolders.marketId,
          db.select({ id: t.markets.id }).from(t.markets).where(sql`${t.markets.source} <> ${DESIGN_SOURCE}`),
        ),
        notInArray(t.marketHolders.marketId, db.select({ id: t.positions.marketId }).from(t.positions)),
      ),
    );
}
