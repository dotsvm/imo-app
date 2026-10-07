/**
 * The data-source port: how the platform reads a venue. One interface for a
 * venue's own API, a licensed aggregator or the in-memory fixture. Everything
 * leaves an adapter already mapped to canonical types.
 */
import type {
  Book,
  CanonicalMarket,
  Candle,
  DataSourceId,
  ExternalRef,
  Resolution,
  Trade,
  VenueId,
} from "@imo/core/market";
import type { FeeModel } from "@imo/core/fees";
import type { MarketStatus } from "@imo/core/lifecycle";
import type {
  Clock,
  HttpClient,
  Logger,
  RateLimiter,
  SecretReader,
} from "@imo/core/ports/runtime";

export interface VenueStatus {
  /** The exchange accepts any state change at all. */
  exchangeActive: boolean;
  /** New orders are accepted. */
  tradingActive: boolean;
  resumesAt?: string;
  checkedAt: string;
}

export interface Page<T> {
  items: T[];
  /** Pass back to get the next page; absent on the last one. */
  next?: string;
}

export type CandleInterval = "1m" | "1h" | "1d";

export interface CandleRange {
  interval: CandleInterval;
  from: string;
  to: string;
}

/** Canonical events on the market-data bus. Downstream consumers — quote
    cache, matcher, alerts, settlement, realtime relay — only ever see these. */
export type MarketDataEvent =
  | { type: "market.upserted"; market: CanonicalMarket }
  | {
      type: "market.status";
      ref: ExternalRef;
      status: MarketStatus;
      at: string;
    }
  | { type: "book.snapshot"; book: Book }
  | {
      type: "book.delta";
      ref: ExternalRef;
      outcome: string;
      side: "bid" | "ask";
      price: number;
      /** New quantity at the price; zero removes the level. */
      quantity: number;
      seq: number;
      at: string;
    }
  | { type: "trade"; trade: Trade }
  | {
      type: "fees.changed";
      ref: ExternalRef;
      model: FeeModel;
      effectiveFrom: string;
    }
  | { type: "resolved"; ref: ExternalRef; resolution: Resolution }
  | { type: "venue.status"; venueId: VenueId; status: VenueStatus };

export type EventSink = (event: MarketDataEvent) => void;

export interface Subscription {
  close(): void;
}

export interface MarketDataSource {
  status(): Promise<VenueStatus>;
  listMarkets(cursor?: string): Promise<Page<CanonicalMarket>>;
  getMarket(ref: ExternalRef): Promise<CanonicalMarket | undefined>;
  getBooks(refs: ExternalRef[]): Promise<Book[]>;
  /** Present when the manifest declares trades. */
  getTrades?(ref: ExternalRef, since?: string): Promise<Trade[]>;
  /** Present when the manifest declares candle intervals. */
  getCandles?(ref: ExternalRef, range: CandleRange): Promise<Candle[]>;
  /** Present when the manifest declares any streaming. */
  stream?(refs: ExternalRef[], sink: EventSink): Subscription;
}

/** What every adapter gets from the platform instead of reaching for globals. */
export interface AdapterContext {
  http: HttpClient;
  rateLimiter: RateLimiter;
  secrets: SecretReader;
  log: Logger;
  clock: Clock;
  config: Readonly<Record<string, string | undefined>>;
}

export interface DataSourceModule {
  id: DataSourceId;
  venues: VenueId[];
  create(context: AdapterContext): MarketDataSource;
}
