/**
 * Polymarket as a data source: Gamma keyset pages for the catalog, CLOB for
 * books (batched by token), Data API v2 for price history, spending the
 * `polymarket:read` budget. The stream polls books until the WebSocket
 * feed (wss://ws-subscriptions-clob.polymarket.com/ws/market) is verified live.
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
import { polymarket } from "./manifest";
import {
  toBook,
  toCandles,
  toCanonicalMarket,
  toTrades,
  yesNoTokens,
} from "./mappers";
import {
  ClobBooks,
  DataTrades,
  GammaMarket,
  MarketsPage,
  PriceHistory,
} from "./schemas";
import type { z } from "zod";

export const POLYMARKET_HOSTS = {
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
  data: "https://data-api.polymarket.com",
} as const;

const BUCKET: Record<CandleInterval, number> = {
  "1m": 60,
  "1h": 3_600,
  "1d": 86_400,
};

export function createPolymarketSource(
  ctx: AdapterContext,
  options: { pollMs?: number } = {},
): MarketDataSource {
  const log = ctx.log.child({
    venue: polymarket.id,
    source: "polymarket-public",
  });
  /** Condition id → Yes/No token ids, learned while listing and fetching. */
  const tokens = new Map<string, { yes: string; no: string }>();

  async function call<T>(
    url: string,
    schema: z.ZodType<T>,
    init?: { method?: "POST"; body?: unknown },
  ): Promise<T> {
    await ctx.rateLimiter.acquire("polymarket:read", 1);
    return schema.parse(
      await ctx.http.json(url, { ...init, idempotent: true }),
    );
  }

  function parseMarkets(raw: unknown[]) {
    const out = [];
    for (const item of raw) {
      const parsed = GammaMarket.safeParse(item);
      if (!parsed.success) {
        log.warn("unparseable market skipped", {
          issues: parsed.error.issues.slice(0, 3),
        });
        continue;
      }
      const market = toCanonicalMarket(parsed.data);
      const pair = yesNoTokens(parsed.data);
      if (market && pair) {
        tokens.set(market.ref.externalId, pair);
        out.push(market);
      }
    }
    return out;
  }

  async function tokensFor(ref: ExternalRef) {
    if (!tokens.has(ref.externalId)) await source.getMarket(ref);
    return tokens.get(ref.externalId);
  }

  const source: MarketDataSource = {
    async status() {
      // The CLOB has no status endpoint; a failing book call shows up as an
      // open circuit and stale quotes instead.
      return {
        exchangeActive: true,
        tradingActive: true,
        checkedAt: ctx.clock.now().toISOString(),
      };
    },

    async listMarkets(cursor) {
      // Tags only come when asked for; they're how a market finds its category.
      const query = new URLSearchParams({ closed: "false", limit: "100", include_tag: "true" });
      if (cursor) query.set("after_cursor", cursor);
      const page = await call(
        `${POLYMARKET_HOSTS.gamma}/markets/keyset?${query}`,
        MarketsPage,
      );
      return {
        items: parseMarkets(page.markets),
        next: page.next_cursor || undefined,
      };
    },

    async getMarket(ref) {
      if (ref.venueId !== polymarket.id) return undefined;
      try {
        const query = new URLSearchParams({ condition_ids: ref.externalId, include_tag: "true" });
        const list = await call(
          `${POLYMARKET_HOSTS.gamma}/markets?${query}`,
          MarketsPage.shape.markets,
        );
        return parseMarkets(list)[0];
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          return undefined;
        throw error;
      }
    },

    async getBooks(refs) {
      const pairs = [];
      for (const ref of refs.filter((r) => r.venueId === polymarket.id)) {
        const pair = await tokensFor(ref);
        if (pair) pairs.push({ ref, ...pair });
      }
      const at = ctx.clock.now().toISOString();
      const books = [];
      for (let i = 0; i < pairs.length; i += 50) {
        const chunk = pairs.slice(i, i + 50);
        const rows = await call(`${POLYMARKET_HOSTS.clob}/books`, ClobBooks, {
          method: "POST",
          body: chunk.flatMap((p) => [{ token_id: p.yes }, { token_id: p.no }]),
        });
        const byToken = new Map(rows.map((row) => [row.asset_id, row]));
        for (const p of chunk)
          books.push(
            toBook(p.ref.externalId, byToken.get(p.yes), byToken.get(p.no), at),
          );
      }
      return books;
    },

    async getTrades(ref) {
      const pair = await tokensFor(ref);
      if (!pair) return [];
      const query = new URLSearchParams({
        market: ref.externalId,
        limit: "100",
      });
      const rows = await call(
        `${POLYMARKET_HOSTS.data}/trades?${query}`,
        DataTrades,
      );
      return toTrades(ref.externalId, pair.yes, rows);
    },

    async getCandles(ref, range) {
      const pair = await tokensFor(ref);
      if (!pair) return [];
      const bucket = BUCKET[range.interval];
      const query = new URLSearchParams({
        token_id: pair.yes,
        start: String(Math.floor(Date.parse(range.from) / 1000)),
        end: String(Math.floor(Date.parse(range.to) / 1000)),
        bucket_seconds: String(bucket),
      });
      return toCandles(
        await call(
          `${POLYMARKET_HOSTS.data}/v2/prices-history?${query}`,
          PriceHistory,
        ),
        bucket,
      );
    },

    stream(refs, sink) {
      return pollingStream(source, polymarket.id, refs, sink, {
        intervalMs: options.pollMs ?? 3_000,
        onError: (error) =>
          log.warn("poll failed", { error: (error as Error).message }),
      });
    },
  };
  return source;
}

export const polymarketSource: DataSourceModule = {
  id: "polymarket-public",
  venues: [polymarket.id],
  create: (ctx) => createPolymarketSource(ctx),
};
