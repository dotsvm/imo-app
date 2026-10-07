/**
 * A stream built from polling, for sources that have no push feed (or no
 * credentials for one yet). Emits the same canonical events a WebSocket
 * source would: a snapshot when a book changes, and venue status changes.
 */
import type { ExternalRef, Book } from "@imo/core/market";
import type {
  EventSink,
  MarketDataSource,
  Subscription,
  VenueStatus,
} from "./source";

export interface PollingOptions {
  intervalMs: number;
  /** Most refs per books request. */
  batch?: number;
  onError?: (error: unknown) => void;
}

const signature = (book: Book) =>
  JSON.stringify(
    book.outcomes.map((o) => [
      o.outcome,
      o.bids.slice(0, 5),
      o.asks.slice(0, 5),
    ]),
  );

export function pollingStream(
  source: Pick<MarketDataSource, "getBooks" | "status">,
  venueId: string,
  refs: ExternalRef[],
  sink: EventSink,
  options: PollingOptions,
): Subscription {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Map<string, string>();
  let lastStatus: string | undefined;
  const batch = options.batch ?? 20;

  const tick = async () => {
    try {
      const status: VenueStatus = await source.status();
      const statusKey = `${status.exchangeActive}:${status.tradingActive}`;
      if (!closed && statusKey !== lastStatus) {
        lastStatus = statusKey;
        sink({ type: "venue.status", venueId, status });
      }
      for (let i = 0; i < refs.length && !closed; i += batch) {
        const books = await source.getBooks(refs.slice(i, i + batch));
        for (const book of books) {
          const sig = signature(book);
          if (closed || seen.get(book.ref.externalId) === sig) continue;
          seen.set(book.ref.externalId, sig);
          sink({ type: "book.snapshot", book });
        }
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      if (!closed) timer = setTimeout(tick, options.intervalMs);
    }
  };
  void tick();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
