/**
 * An in-memory venue with controls: set a book, pause trading, resolve a
 * market — and every subscriber sees the change as canonical events, exactly
 * as it would from a real venue's stream.
 */
import type { MarketStatus } from "@imo/core/lifecycle";
import { canTransition } from "@imo/core/lifecycle";
import {
  complementLevels,
  type Book,
  type BookLevel,
  type CanonicalMarket,
  type Candle,
  type ExternalRef,
  type Trade,
} from "@imo/core/market";
import type {
  CandleRange,
  DataSourceModule,
  EventSink,
  MarketDataEvent,
  MarketDataSource,
  VenueStatus,
} from "../sdk/source";
import { fixture } from "./manifest";

const ONE = 1_000_000; // USD micro-dollars per share payout
const CENT = 10_000;

export interface FixtureSeed {
  id: string;
  title: string;
  status?: MarketStatus;
  /** Yes mid-price in cents. */
  yesCents: number;
  /** Shares at each of five levels a side. */
  depth?: number;
  closesAt?: string;
}

export const DEFAULT_SEEDS: FixtureSeed[] = [
  { id: "FX-RATES-DEC", title: "Rates cut in December", yesCents: 62 },
  { id: "FX-CPI-OCT", title: "October CPI above 3.0%", yesCents: 41 },
  { id: "FX-BTC-150K", title: "BTC above $150K this year", yesCents: 20 },
  {
    id: "FX-LAUNCH",
    title: "Launch happens this quarter",
    yesCents: 55,
    status: "paused",
  },
  {
    id: "FX-ELECTION",
    title: "Incumbent keeps the seat",
    yesCents: 71,
    status: "closed",
  },
  {
    id: "FX-STORM",
    title: "Category 4 landfall",
    yesCents: 8,
    status: "resolved",
  },
];

function marketFrom(seed: FixtureSeed): CanonicalMarket {
  const status = seed.status ?? "open";
  return {
    ref: { venueId: fixture.id, externalId: seed.id },
    type: "binary",
    title: seed.title,
    rules: `Resolves Yes if ${seed.title.toLowerCase()}, per the fixture's source.`,
    resolutionSource: "Fixture source",
    categoryHints: ["fixture"],
    outcomes: [
      { key: "yes", label: "Yes", index: 0 },
      { key: "no", label: "No", index: 1 },
    ],
    status,
    currency: fixture.collateral,
    tick: CENT,
    quantityScale: 0,
    quantityStep: 1,
    venueFee: fixture.fees.default,
    closesAt: seed.closesAt ?? "2026-12-31T23:59:00Z",
    resolution:
      status === "resolved"
        ? { outcome: "no", final: true, resolvedAt: "2026-09-20T12:00:00Z" }
        : undefined,
  };
}

/** Five levels a side around the mid, one cent apart. */
function bookAround(
  ref: ExternalRef,
  yesCents: number,
  depth: number,
  at: string,
): Book {
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  for (let i = 0; i < 5; i++) {
    const bid = yesCents - 1 - i;
    const ask = yesCents + 1 + i;
    if (bid >= 1) bids.push({ price: bid * CENT, quantity: depth * (i + 1) });
    if (ask <= 99) asks.push({ price: ask * CENT, quantity: depth * (i + 1) });
  }
  return {
    ref,
    at,
    outcomes: [
      { outcome: "yes", bids, asks },
      {
        outcome: "no",
        // A Yes ask at p is a No bid at 1 − p, and the other way round.
        bids: complementLevels(asks, ONE).reverse(),
        asks: complementLevels(bids, ONE),
      },
    ],
  };
}

export interface FixtureVenue {
  source: MarketDataSource;
  control: {
    /** Move a market's Yes mid-price, publishing a new book. */
    setYes(externalId: string, yesCents: number): void;
    setStatus(externalId: string, status: MarketStatus): void;
    resolve(
      externalId: string,
      outcome: "yes" | "no" | "void",
      final?: boolean,
    ): void;
    setTrading(active: boolean, resumesAt?: string): void;
    trade(
      externalId: string,
      outcome: "yes" | "no",
      priceCents: number,
      quantity: number,
    ): void;
    /** Drop a market from listings while it can still be looked up — the
        way venues list only open markets. */
    unlist(externalId: string): void;
    /** The venue forgets the market entirely. */
    remove(externalId: string): void;
  };
}

export function createFixtureVenue(
  seeds: FixtureSeed[] = DEFAULT_SEEDS,
  now: () => Date = () => new Date("2026-09-25T14:26:00Z"),
): FixtureVenue {
  const markets = new Map<string, CanonicalMarket>();
  const mids = new Map<string, number>();
  const depths = new Map<string, number>();
  const trades = new Map<string, Trade[]>();
  for (const seed of seeds) {
    markets.set(seed.id, marketFrom(seed));
    mids.set(seed.id, seed.yesCents);
    depths.set(seed.id, seed.depth ?? 100);
    trades.set(seed.id, []);
  }
  let venueStatus: VenueStatus = {
    exchangeActive: true,
    tradingActive: true,
    checkedAt: now().toISOString(),
  };
  const subscribers = new Set<{ ids: Set<string>; sink: EventSink }>();
  const unlisted = new Set<string>();
  /** Listings carry top of book, as venue listings do. */
  const listed = (market: CanonicalMarket): CanonicalMarket => {
    const mid = mids.get(market.ref.externalId)!;
    return {
      ...structuredClone(market),
      snapshot: {
        yesBid: (mid - 1) * CENT,
        yesAsk: (mid + 1) * CENT,
        last: mid * CENT,
      },
    };
  };

  const publish = (externalId: string | null, event: MarketDataEvent) => {
    for (const subscriber of subscribers)
      if (externalId === null || subscriber.ids.has(externalId))
        subscriber.sink(event);
  };
  const must = (externalId: string) => {
    const market = markets.get(externalId);
    if (!market) throw new RangeError(`No fixture market ${externalId}`);
    return market;
  };
  const bookOf = (externalId: string) =>
    bookAround(
      must(externalId).ref,
      mids.get(externalId)!,
      depths.get(externalId)!,
      now().toISOString(),
    );

  const source: MarketDataSource = {
    async status() {
      return { ...venueStatus, checkedAt: now().toISOString() };
    },
    async listMarkets(cursor) {
      const all = [...markets.values()].filter(
        (m) => !unlisted.has(m.ref.externalId),
      );
      const start = cursor ? Number(cursor) : 0;
      const items = all.slice(start, start + 4);
      const next = start + 4 < all.length ? String(start + 4) : undefined;
      return { items: items.map(listed), next };
    },
    async getMarket(ref) {
      const market =
        ref.venueId === fixture.id ? markets.get(ref.externalId) : undefined;
      return market && listed(market);
    },
    async getBooks(refs) {
      return refs
        .filter(
          (ref) => ref.venueId === fixture.id && markets.has(ref.externalId),
        )
        .map((ref) => bookOf(ref.externalId));
    },
    async getTrades(ref) {
      return structuredClone(trades.get(ref.externalId) ?? []);
    },
    async getCandles(ref, range: CandleRange) {
      const mid = mids.get(ref.externalId);
      if (mid === undefined) return [];
      const step = range.interval === "1d" ? 86_400_000 : 3_600_000;
      const from = Date.parse(range.from);
      const to = Date.parse(range.to);
      const candles: Candle[] = [];
      for (let t = from, i = 0; t < to && i < 500; t += step, i++) {
        // A gentle, deterministic wave around the mid.
        const drift = Math.round(Math.sin(i / 3) * 3);
        const close = Math.min(99, Math.max(1, mid + drift)) * CENT;
        candles.push({
          start: new Date(t).toISOString(),
          open: close,
          high: Math.min(ONE, close + CENT),
          low: Math.max(0, close - CENT),
          close,
        });
      }
      return candles;
    },
    stream(refs, sink) {
      const subscriber = {
        ids: new Set(
          refs.filter((r) => r.venueId === fixture.id).map((r) => r.externalId),
        ),
        sink,
      };
      subscribers.add(subscriber);
      // Like a venue's first frame: a snapshot of everything subscribed.
      queueMicrotask(() => {
        if (!subscribers.has(subscriber)) return;
        for (const id of subscriber.ids)
          if (markets.has(id))
            sink({ type: "book.snapshot", book: bookOf(id) });
      });
      return { close: () => void subscribers.delete(subscriber) };
    },
  };

  const control: FixtureVenue["control"] = {
    setYes(externalId, yesCents) {
      must(externalId);
      if (!Number.isInteger(yesCents) || yesCents < 1 || yesCents > 99)
        throw new RangeError("Yes price must be 1–99 cents");
      mids.set(externalId, yesCents);
      publish(externalId, { type: "book.snapshot", book: bookOf(externalId) });
    },
    setStatus(externalId, status) {
      const market = must(externalId);
      if (!canTransition(market.status, status))
        throw new RangeError(`${market.status} → ${status} is not legal`);
      market.status = status;
      publish(externalId, {
        type: "market.status",
        ref: market.ref,
        status,
        at: now().toISOString(),
      });
    },
    resolve(externalId, outcome, final = true) {
      const market = must(externalId);
      // A final result never changes: repeating it is a no-op, contradicting
      // it is an error.
      if (market.resolution?.final) {
        if (market.resolution.outcome === outcome) return;
        throw new RangeError(
          `${externalId} is already final (${market.resolution.outcome}); ${outcome} is not legal`,
        );
      }
      const status =
        outcome === "void" ? "voided" : final ? "resolved" : "determined";
      control.setStatus(externalId, status);
      market.resolution = { outcome, final, resolvedAt: now().toISOString() };
      publish(externalId, {
        type: "resolved",
        ref: market.ref,
        resolution: market.resolution,
      });
    },
    setTrading(active, resumesAt) {
      venueStatus = {
        exchangeActive: true,
        tradingActive: active,
        resumesAt,
        checkedAt: now().toISOString(),
      };
      publish(null, {
        type: "venue.status",
        venueId: fixture.id,
        status: venueStatus,
      });
    },
    trade(externalId, outcome, priceCents, quantity) {
      const market = must(externalId);
      const trade: Trade = {
        ref: market.ref,
        outcome,
        price: priceCents * CENT,
        quantity,
        at: now().toISOString(),
      };
      trades.get(externalId)!.push(trade);
      publish(externalId, { type: "trade", trade });
    },
    unlist(externalId) {
      must(externalId);
      unlisted.add(externalId);
    },
    remove(externalId) {
      must(externalId);
      markets.delete(externalId);
      unlisted.delete(externalId);
    },
  };

  return { source, control };
}

export const fixtureSource: DataSourceModule = {
  id: "fixture",
  venues: [fixture.id],
  create: () => createFixtureVenue().source,
};
