/**
 * Jupiter Predict as a data source: the event catalog for each provider it
 * routes to (Kalshi, Polymarket), markets by id, and per-market books, on the
 * `jupiter:read` budget. Reads work without a key at a low rate; set the
 * JUPITER_API_KEY secret (developers.jup.ag/portal) for the plan's rate.
 * There's no public stream, so books are polled.
 */
import { HttpError } from "@imo/core/ports/runtime";
import type { AdapterContext, DataSourceModule, MarketDataSource } from "../sdk/source";
import { pollingStream } from "../sdk/polling";
import { jupiter } from "./manifest";
import { toBook, toCanonicalMarket } from "./mappers";
import { EventsPage, JupiterEvent, JupiterMarket, Orderbook, TradingStatus } from "./schemas";
import type { z } from "zod";

export const JUPITER_HOST = "https://api.jup.ag";
const BASE = `${JUPITER_HOST}/prediction/v1`;
/** Providers Predict routes to, in listing order. (`bisonfi` is Jupiter's own
    15-minute BTC rounds: too short-lived for a social feed.) */
export const PROVIDERS = ["kalshi", "polymarket"] as const;
/** Events per page. The API allows 100, but an event can hold dozens of
    markets: small pages get prices into the catalog sooner. */
const PAGE = 10;

export function createJupiterSource(ctx: AdapterContext, options: { pollMs?: number } = {}): MarketDataSource {
  const log = ctx.log.child({ venue: jupiter.id, source: "jupiter-predict" });
  /** Event id → the event (without its markets), learned while listing. */
  const events = new Map<string, JupiterEvent>();
  let key: string | undefined | null = null;

  async function call<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    if (key === null) key = (await ctx.secrets.get("JUPITER_API_KEY")) || undefined;
    await ctx.rateLimiter.acquire("jupiter:read", 1);
    return schema.parse(
      await ctx.http.json(`${BASE}${path}`, {
        headers: key ? { "x-api-key": key } : undefined,
        idempotent: true,
        timeoutMs: 20_000,
      }),
    );
  }

  function marketsOf(event: JupiterEvent) {
    const out = [];
    for (const raw of event.markets ?? []) {
      const parsed = JupiterMarket.safeParse(raw);
      if (!parsed.success) {
        log.warn("unparseable market skipped", { event: event.eventId, issues: parsed.error.issues.slice(0, 3) });
        continue;
      }
      const market = toCanonicalMarket({ ...parsed.data, eventId: parsed.data.eventId ?? event.eventId }, event);
      if (market) out.push(market);
    }
    return out;
  }

  async function eventFor(eventId: string | undefined) {
    if (!eventId) return undefined;
    const known = events.get(eventId);
    if (known) return known;
    try {
      const event = await call(`/events/${encodeURIComponent(eventId)}`, JupiterEvent);
      events.set(eventId, { ...event, markets: undefined });
      return event;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  const source: MarketDataSource = {
    async status() {
      const status = await call("/trading-status", TradingStatus);
      return {
        exchangeActive: true,
        tradingActive: status.trading_active,
        checkedAt: ctx.clock.now().toISOString(),
      };
    },

    /** Cursor: "<provider index>:<event offset>". */
    async listMarkets(cursor) {
      const [p, offset] = (cursor ?? "0:0").split(":").map(Number);
      const provider = PROVIDERS[p ?? 0];
      if (!provider) return { items: [] };
      const start = offset ?? 0;
      const query = new URLSearchParams({
        provider,
        includeMarkets: "true",
        // Busiest first, so a slow or interrupted pass still has the markets people trade.
        sortBy: "volume",
        sortDirection: "desc",
        start: String(start),
        end: String(start + PAGE),
      });
      const page = await call(`/events?${query}`, EventsPage);
      const items = [];
      for (const raw of page.data) {
        const parsed = JupiterEvent.safeParse(raw);
        if (!parsed.success) {
          log.warn("unparseable event skipped", { issues: parsed.error.issues.slice(0, 3) });
          continue;
        }
        events.set(parsed.data.eventId, { ...parsed.data, markets: undefined });
        items.push(...marketsOf(parsed.data));
      }
      const more = page.pagination?.hasNext ?? page.data.length === PAGE;
      const next = more ? `${p}:${start + PAGE}` : (p ?? 0) + 1 < PROVIDERS.length ? `${(p ?? 0) + 1}:0` : undefined;
      return { items, next };
    },

    async getMarket(ref) {
      if (ref.venueId !== jupiter.id) return undefined;
      try {
        const market = await call(`/markets/${encodeURIComponent(ref.externalId)}`, JupiterMarket);
        const event = await eventFor(market.eventId);
        return toCanonicalMarket(market, event) ?? undefined;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return undefined;
        throw error;
      }
    },

    async getBooks(refs) {
      const at = ctx.clock.now().toISOString();
      const books = [];
      for (const ref of refs.filter((r) => r.venueId === jupiter.id)) {
        try {
          const book = await call(`/orderbook/${encodeURIComponent(ref.externalId)}`, Orderbook);
          books.push(toBook(ref.externalId, book, at));
        } catch (error) {
          // A market without a book (closed, or a provider hiccup) shouldn't sink the batch.
          log.warn("book unavailable", { market: ref.externalId, error: (error as Error).message });
        }
      }
      return books;
    },

    stream(refs, sink) {
      return pollingStream(source, jupiter.id, refs, sink, {
        intervalMs: options.pollMs ?? 15_000,
        onError: (error) => log.warn("poll failed", { error: (error as Error).message }),
      });
    },
  };
  return source;
}

export const jupiterSource: DataSourceModule = {
  id: "jupiter-predict",
  venues: [jupiter.id],
  create: (ctx) => createJupiterSource(ctx),
};
