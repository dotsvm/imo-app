/**
 * Kalshi as a data source: public REST for the catalog, books, trades,
 * candles and exchange status, spending the `kalshi:read` budget (10 tokens a
 * request). The stream polls until WebSocket credentials exist; the WS feed
 * slots in behind the same interface.
 */
import type { ExternalRef } from "@imo/core/market";
import { HttpError } from "@imo/core/ports/runtime";
import type {
  AdapterContext,
  CandleInterval,
  DataSourceModule,
  MarketDataSource,
} from "../sdk/source";
import { pollingStream } from "../sdk/polling";
import { kalshi } from "./manifest";
import {
  listable,
  toBook,
  toCandles,
  toCanonicalMarket,
  toTrades,
} from "./mappers";
import {
  CandlesResponse,
  EventResponse,
  EventsPage,
  ExchangeStatus,
  MarketResponse,
  OrderbooksResponse,
  SeriesResponse,
  TradesResponse,
  type KalshiEvent,
} from "./schemas";
import type { z } from "zod";

export const KALSHI_HOSTS = {
  production: "https://external-api.kalshi.com/trade-api/v2",
  demo: "https://external-api.demo.kalshi.co/trade-api/v2",
} as const;

const PERIOD: Record<CandleInterval, number> = {
  "1m": 1,
  "1h": 60,
  "1d": 1440,
};
const SERIES_TTL_MS = 60 * 60 * 1000;

export interface KalshiSourceOptions {
  env: keyof typeof KALSHI_HOSTS;
  pollMs?: number;
}

export function createKalshiSource(
  ctx: AdapterContext,
  options: KalshiSourceOptions,
): MarketDataSource {
  const base = KALSHI_HOSTS[options.env];
  const log = ctx.log.child({
    venue: kalshi.id,
    source: `kalshi-${options.env}`,
  });
  const series = new Map<
    string,
    { value: z.infer<typeof SeriesResponse>["series"]; at: number }
  >();
  const eventOf = new Map<
    string,
    Pick<KalshiEvent, "title" | "category" | "series_ticker">
  >();
  /** Market ticker → event ticker, learned while listing and fetching. */
  const eventTickerOf = new Map<string, string>();

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    await ctx.rateLimiter.acquire("kalshi:read", 10);
    return schema.parse(await ctx.http.json(`${base}${path}`));
  }

  async function seriesFor(ticker: string) {
    const cached = series.get(ticker);
    if (cached && ctx.clock.now().getTime() - cached.at < SERIES_TTL_MS)
      return cached.value;
    try {
      const { series: value } = await get(
        `/series/${encodeURIComponent(ticker)}`,
        SeriesResponse,
      );
      series.set(ticker, { value, at: ctx.clock.now().getTime() });
      return value;
    } catch (error) {
      log.warn("series lookup failed", {
        series: ticker,
        error: (error as Error).message,
      });
      return undefined;
    }
  }

  const source: MarketDataSource = {
    async status() {
      const s = await get("/exchange/status", ExchangeStatus);
      return {
        exchangeActive: s.exchange_active,
        tradingActive: s.trading_active,
        resumesAt: s.exchange_estimated_resume_time ?? undefined,
        checkedAt: ctx.clock.now().toISOString(),
      };
    },

    async listMarkets(cursor) {
      const query = new URLSearchParams({
        status: "open",
        with_nested_markets: "true",
        limit: "100",
      });
      if (cursor) query.set("cursor", cursor);
      const page = await get(`/events?${query}`, EventsPage);
      const items = [];
      for (const event of page.events) {
        const info = await seriesFor(event.series_ticker);
        eventOf.set(event.event_ticker, event);
        for (const market of event.markets ?? [])
          if (listable(market)) {
            eventTickerOf.set(market.ticker, event.event_ticker);
            items.push(toCanonicalMarket(market, event, info));
          }
      }
      return { items, next: page.cursor || undefined };
    },

    async getMarket(ref: ExternalRef) {
      if (ref.venueId !== kalshi.id) return undefined;
      try {
        const { market } = await get(
          `/markets/${encodeURIComponent(ref.externalId)}`,
          MarketResponse,
        );
        if (!listable(market)) return undefined;
        eventTickerOf.set(market.ticker, market.event_ticker);
        let event = eventOf.get(market.event_ticker);
        if (!event) {
          const found = await get(
            `/events/${encodeURIComponent(market.event_ticker)}`,
            EventResponse,
          );
          event = found.event;
          eventOf.set(market.event_ticker, event);
        }
        return toCanonicalMarket(
          market,
          event,
          await seriesFor(event.series_ticker),
        );
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          return undefined;
        throw error;
      }
    },

    async getBooks(refs) {
      const tickers = refs
        .filter((r) => r.venueId === kalshi.id)
        .map((r) => r.externalId);
      const at = ctx.clock.now().toISOString();
      const books = [];
      // The batch endpoint takes the parameter repeated, never comma-joined.
      for (let i = 0; i < tickers.length; i += 100) {
        const query = new URLSearchParams();
        for (const ticker of tickers.slice(i, i + 100))
          query.append("tickers", ticker);
        const page = await get(
          `/markets/orderbooks?${query}`,
          OrderbooksResponse,
        );
        for (const entry of page.orderbooks)
          books.push(toBook(entry.ticker, entry.orderbook_fp, at));
      }
      return books;
    },

    async getTrades(ref, since) {
      const query = new URLSearchParams({
        ticker: ref.externalId,
        limit: "100",
      });
      if (since)
        query.set("min_ts", String(Math.floor(Date.parse(since) / 1000)));
      return toTrades(await get(`/markets/trades?${query}`, TradesResponse));
    },

    async getCandles(ref, range) {
      if (!eventTickerOf.has(ref.externalId)) await source.getMarket(ref);
      const eventTicker = eventTickerOf.get(ref.externalId);
      const event = eventTicker ? eventOf.get(eventTicker) : undefined;
      if (!event) return [];
      const period = PERIOD[range.interval];
      const query = new URLSearchParams({
        start_ts: String(Math.floor(Date.parse(range.from) / 1000)),
        end_ts: String(Math.floor(Date.parse(range.to) / 1000)),
        period_interval: String(period),
      });
      const page = await get(
        `/series/${encodeURIComponent(event.series_ticker)}/markets/${encodeURIComponent(ref.externalId)}/candlesticks?${query}`,
        CandlesResponse,
      );
      return toCandles(page, period * 60);
    },

    stream(refs, sink) {
      return pollingStream(source, kalshi.id, refs, sink, {
        intervalMs: options.pollMs ?? 3_000,
        onError: (error) =>
          log.warn("poll failed", { error: (error as Error).message }),
      });
    },
  };
  return source;
}

export const kalshiDemoSource: DataSourceModule = {
  id: "kalshi-demo",
  venues: [kalshi.id],
  create: (ctx) => createKalshiSource(ctx, { env: "demo" }),
};

export const kalshiProductionSource: DataSourceModule = {
  id: "kalshi-direct",
  venues: [kalshi.id],
  create: (ctx) => createKalshiSource(ctx, { env: "production" }),
};
