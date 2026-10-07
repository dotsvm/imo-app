/**
 * The venue conformance kit. Every data source runs this suite; a source that
 * fails it can't be enabled. It checks what the rest of the platform relies
 * on: complete pages, well-formed canonical markets and books, honest
 * capability claims, and streams that respect their subscriptions.
 *
 * Call it from a test file:
 *   defineVenueConformance({ manifest: fixture, create: () => createFixtureVenue().source });
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { feeFor } from "@imo/core/fees";
import { MARKET_STATUSES } from "@imo/core/lifecycle";
import { isWellFormed, onTickGrid, type CanonicalMarket } from "@imo/core/market";
import { currency } from "@imo/core/money";
import { defineVenue, type VenueManifest } from "./manifest";
import type { MarketDataEvent, MarketDataSource } from "./source";

export interface ConformanceOptions {
  manifest: VenueManifest;
  create: () => MarketDataSource | Promise<MarketDataSource>;
  /** Stop paging after this many pages. */
  maxPages?: number;
  /** How many markets to probe for books, candles and streams. */
  sample?: number;
  /** How long to wait for a stream's first event. */
  streamTimeoutMs?: number;
}

const iso = (value: string | undefined) =>
  value === undefined || !Number.isNaN(Date.parse(value));

export function checkMarket(market: CanonicalMarket, manifest: VenueManifest) {
  const where = `${market.ref.venueId}:${market.ref.externalId}`;
  assert.equal(
    market.ref.venueId,
    manifest.id,
    `${where} belongs to another venue`,
  );
  assert.ok(market.ref.externalId, `${where} has no external id`);
  assert.ok(
    manifest.capabilities.marketTypes.includes(market.type),
    `${where}: undeclared type ${market.type}`,
  );
  assert.ok(
    MARKET_STATUSES.includes(market.status),
    `${where}: status ${market.status}`,
  );
  assert.ok(market.title.trim(), `${where}: empty title`);
  const keys = market.outcomes.map((o) => o.key);
  assert.equal(
    new Set(keys).size,
    keys.length,
    `${where}: duplicate outcome keys`,
  );
  if (market.type === "binary")
    assert.deepEqual(
      [...keys].sort(),
      ["no", "yes"],
      `${where}: binary outcomes`,
    );
  const { scale } = currency(market.currency);
  const one = 10 ** scale;
  assert.ok(
    Number.isSafeInteger(market.tick) && market.tick > 0 && market.tick < one,
    `${where}: tick`,
  );
  assert.ok(
    Number.isInteger(market.quantityScale) &&
      market.quantityScale >= 0 &&
      market.quantityScale <= 6,
    `${where}: quantityScale`,
  );
  assert.ok(
    Number.isSafeInteger(market.quantityStep) && market.quantityStep > 0,
    `${where}: quantityStep`,
  );
  if (!manifest.capabilities.fractionalQuantity)
    assert.equal(
      market.quantityScale,
      0,
      `${where}: fractional sizes on a whole-share venue`,
    );
  assert.ok(
    iso(market.closesAt) &&
      iso(market.opensAt) &&
      iso(market.expectedResolutionAt),
    `${where}: dates`,
  );
  const fee = feeFor(market.venueFee, {
    price: Math.floor(one / 2),
    quantity: 10 ** market.quantityScale,
    quantityScale: market.quantityScale,
    currencyScale: scale,
    liquidity: "taker",
  });
  assert.ok(fee >= 0, `${where}: negative fee`);
  if (market.status === "resolved") {
    assert.ok(
      market.resolution?.final,
      `${where}: resolved without a final result`,
    );
    const outcome = market.resolution.outcome;
    assert.ok(
      outcome === "void" || keys.includes(outcome),
      `${where}: unknown winning outcome`,
    );
  }
}

export function defineVenueConformance(options: ConformanceOptions) {
  const {
    manifest,
    maxPages = 50,
    sample = 5,
    streamTimeoutMs = 2_000,
  } = options;
  const caps = manifest.capabilities;

  describe(`venue conformance · ${manifest.id}`, () => {
    let source: MarketDataSource;
    const markets: CanonicalMarket[] = [];

    it("has a valid manifest", () => {
      assert.doesNotThrow(() => defineVenue(manifest));
    });

    it("reports its status", async () => {
      source = await options.create();
      const status = await source.status();
      assert.equal(typeof status.tradingActive, "boolean");
      assert.equal(typeof status.exchangeActive, "boolean");
      assert.ok(iso(status.checkedAt) && iso(status.resumesAt));
    });

    it("pages through the whole catalog with stable, unique ids", async () => {
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await source.listMarkets(cursor);
        for (const market of page.items) {
          assert.ok(
            !seen.has(market.ref.externalId),
            `duplicate ${market.ref.externalId}`,
          );
          seen.add(market.ref.externalId);
          markets.push(market);
        }
        cursor = page.next;
        pages++;
      } while (cursor && pages < maxPages);
      assert.ok(markets.length > 0, "the catalog is empty");
    });

    it("maps every market to a well-formed canonical market", () => {
      for (const market of markets) checkMarket(market, manifest);
    });

    it("returns the same market by reference", async () => {
      for (const market of markets.slice(0, sample)) {
        const again = await source.getMarket(market.ref);
        assert.ok(again, `${market.ref.externalId} not found by ref`);
        assert.deepEqual(again.ref, market.ref);
      }
      assert.equal(
        await source.getMarket({
          venueId: manifest.id,
          externalId: "__missing__",
        }),
        undefined,
      );
    });

    it("serves well-formed books on the tick grid", async () => {
      const probe = markets.filter((m) => m.status === "open").slice(0, sample);
      const books = await source.getBooks(probe.map((m) => m.ref));
      assert.equal(books.length, probe.length, "a book is missing");
      for (const book of books) {
        const market = probe.find(
          (m) => m.ref.externalId === book.ref.externalId,
        )!;
        const one = 10 ** currency(market.currency).scale;
        assert.deepEqual(
          book.outcomes.map((o) => o.outcome).sort(),
          market.outcomes.map((o) => o.key).sort(),
          `${market.ref.externalId}: book outcomes`,
        );
        for (const side of book.outcomes) {
          assert.ok(
            isWellFormed(side),
            `${market.ref.externalId}/${side.outcome}: malformed book`,
          );
          for (const level of [...side.bids, ...side.asks]) {
            assert.ok(
              level.price > 0 && level.price < one,
              "price out of range",
            );
            if (caps.tick !== "dynamic")
              assert.ok(
                onTickGrid(level.price, market),
                `price ${level.price} off the tick grid`,
              );
            assert.equal(
              level.quantity % market.quantityStep,
              0,
              "size off the step",
            );
          }
        }
        assert.ok(iso(book.at));
      }
    });

    it("keeps its capability claims", () => {
      assert.equal(
        typeof source.getCandles === "function",
        caps.history.candleIntervals.length > 0,
        "candle support doesn't match the manifest",
      );
      const streams =
        caps.streaming.quotes ||
        caps.streaming.trades ||
        caps.streaming.lifecycle ||
        caps.streaming.book !== "none";
      assert.equal(
        typeof source.stream === "function",
        streams,
        "stream support doesn't match the manifest",
      );
      assert.equal(
        typeof source.getTrades === "function",
        caps.streaming.trades,
        "trade support doesn't match",
      );
    });

    it(
      "returns ordered candles",
      { skip: caps.history.candleIntervals.length === 0 },
      async () => {
        const market = markets.find((m) => m.status === "open");
        if (!market || !source.getCandles) return;
        const candles = await source.getCandles(market.ref, {
          interval: caps.history.candleIntervals.at(-1)!,
          from: "2026-09-01T00:00:00Z",
          to: "2026-09-25T00:00:00Z",
        });
        candles.forEach((candle, i) => {
          assert.ok(candle.low <= candle.open && candle.open <= candle.high);
          assert.ok(candle.low <= candle.close && candle.close <= candle.high);
          if (i)
            assert.ok(
              Date.parse(candle.start) > Date.parse(candles[i - 1].start),
              "candles out of order",
            );
        });
      },
    );

    it(
      "streams only what was subscribed, and stops when closed",
      { skip: !caps.streaming.quotes },
      async () => {
        const [market] = markets.filter((m) => m.status === "open");
        if (!market || !source.stream) return;
        const events: MarketDataEvent[] = [];
        const first = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("no event before the timeout")),
            streamTimeoutMs,
          );
          const subscription = source.stream!([market.ref], (event) => {
            events.push(event);
            clearTimeout(timer);
            subscription.close();
            resolve();
          });
        });
        await first;
        for (const event of events) {
          const ref =
            event.type === "book.snapshot"
              ? event.book.ref
              : event.type === "trade"
                ? event.trade.ref
                : "ref" in event
                  ? event.ref
                  : undefined;
          if (ref)
            assert.equal(
              ref.externalId,
              market.ref.externalId,
              "an unsubscribed market streamed",
            );
        }
        const count = events.length;
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(
          events.length,
          count,
          "events kept arriving after close()",
        );
      },
    );
  });
}
