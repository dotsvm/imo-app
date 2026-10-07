/**
 * The design dataset as a data source: the fictional markets from the design
 * exports (fed-dec, cpi-oct, btc…), with their books, tapes and 7-day paths,
 * served through the same SDK contract as a live venue. Demo and test
 * profiles ingest from it; production never registers it.
 *
 * Markets keep their display venue (Kalshi or Polymarket) — the data source
 * is this dataset, which is exactly the venue/source split the extensibility
 * contract describes.
 */
import type { FeeModel } from "@imo/core/fees";
import type { Book, CanonicalMarket, Candle, Trade } from "@imo/core/market";
import type { Market } from "@imo/domain/types";
import { markets as designMarkets } from "@imo/domain/demo/hunch-data";
import { mockOrderBook, mockRecentTrades } from "@imo/domain/demo/fixtures";
import type { DataSourceModule, MarketDataSource } from "@imo/venues/sdk/source";
import { pollingStream } from "@imo/venues/sdk/polling";

export const DESIGN_SOURCE = "demo-design";
const CENT = 10_000; // micro-dollars per cent
/** The snapshot every design figure describes. */
export const DESIGN_SNAPSHOT = "2026-09-25T14:26:00Z";

const statusOf = (m: Market): CanonicalMarket["status"] =>
  m.status === "resolved"
    ? "resolved"
    : m.status === "closed"
      ? "closed"
      : "open";

export function designToCanonical(m: Market): CanonicalMarket {
  const outcome = m.resolution.outcome?.toLowerCase();
  return {
    ref: { venueId: m.venueId, externalId: m.venueContractId },
    type: "binary",
    title: m.title,
    shortTitle: m.shortTitle,
    description: m.description,
    rules: m.resolution.rule,
    resolutionSource: m.resolution.source,
    categoryHints: [m.category],
    outcomes: [
      { key: "yes", label: "Yes", index: 0 },
      { key: "no", label: "No", index: 1 },
    ],
    status: statusOf(m),
    currency: "USD",
    tick: CENT,
    quantityScale: 0,
    quantityStep: 1,
    venueFee: m.venueFee as FeeModel,
    closesAt: m.closesAt,
    resolution: outcome
      ? { outcome, final: m.status === "resolved" }
      : undefined,
    stats: {
      volume: m.volumeCents * CENT,
      openInterest: m.openInterestCents * CENT,
      liquidity: m.liquidityCents * CENT,
    },
  };
}

export const designMarket = (externalId: string) =>
  designMarkets.find((m) => m.venueContractId === externalId);

export function designBook(m: Market, at: string): Book {
  const book = mockOrderBook(m);
  const toLevels = (levels: { priceCents: number; shares: number }[]) =>
    levels.map((l) => ({ price: l.priceCents * CENT, quantity: l.shares }));
  const yesBids = toLevels(book.bids).sort((a, b) => b.price - a.price);
  const yesAsks = toLevels(book.asks).sort((a, b) => a.price - b.price);
  return {
    ref: { venueId: m.venueId, externalId: m.venueContractId },
    at,
    outcomes: [
      { outcome: "yes", bids: yesBids, asks: yesAsks },
      {
        outcome: "no",
        bids: yesAsks.map((l) => ({
          price: 1_000_000 - l.price,
          quantity: l.quantity,
        })),
        asks: yesBids.map((l) => ({
          price: 1_000_000 - l.price,
          quantity: l.quantity,
        })),
      },
    ],
  };
}

export function createDesignSource(
  now: () => Date = () => new Date(DESIGN_SNAPSHOT),
): MarketDataSource {
  const source: MarketDataSource = {
    async status() {
      return {
        exchangeActive: true,
        tradingActive: true,
        checkedAt: now().toISOString(),
      };
    },
    async listMarkets() {
      return { items: designMarkets.map(designToCanonical) };
    },
    async getMarket(ref) {
      const m = designMarket(ref.externalId);
      return m && m.venueId === ref.venueId ? designToCanonical(m) : undefined;
    },
    async getBooks(refs) {
      const at = now().toISOString();
      return refs.flatMap((ref) => {
        const m = designMarket(ref.externalId);
        return m && m.status === "open" ? [designBook(m, at)] : [];
      });
    },
    async getTrades(ref) {
      const m = designMarket(ref.externalId);
      if (!m) return [];
      const snapshot = Date.parse(DESIGN_SNAPSHOT);
      return mockRecentTrades(m).map((trade): Trade => ({
        ref,
        outcome: "yes",
        price:
          (trade.outcome === "Yes"
            ? trade.priceCents
            : 100 - trade.priceCents) * CENT,
        quantity: trade.shares,
        at: new Date(snapshot - trade.minutesAgo * 60_000).toISOString(),
        side: trade.outcome === "Yes" ? "buy" : "sell",
      }));
    },
    async getCandles(ref) {
      const m = designMarket(ref.externalId);
      if (!m) return [];
      // The 7-day path, one point every ~4.7 hours, ending at the snapshot.
      const end = Date.parse(DESIGN_SNAPSHOT);
      const step = (7 * 86_400_000) / (m.series.length - 1);
      return m.series.map((cents, i): Candle => {
        const price = cents * CENT;
        return {
          start: new Date(end - (m.series.length - 1 - i) * step).toISOString(),
          open: price,
          high: price,
          low: price,
          close: price,
        };
      });
    },
    stream(refs, sink) {
      return pollingStream(source, "design", refs, sink, { intervalMs: 5_000 });
    },
  };
  return source;
}

export const designSource: DataSourceModule = {
  id: DESIGN_SOURCE,
  venues: [...new Set(designMarkets.map((m) => m.venueId))],
  create: () => createDesignSource(),
};

/** The design's quote figures, for seeding the quote cache. */
export const designQuote = (m: Market) => ({
  yesBid: (m.yesPrice - 1) * CENT,
  yesAsk: (m.yesPrice + 1) * CENT,
  last: m.yesPrice * CENT,
  change24h: Math.round(m.change * CENT),
  series: m.series.map((cents) => cents * CENT),
});
