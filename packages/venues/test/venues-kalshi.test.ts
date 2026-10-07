import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScriptedHttp, type Recording } from "@imo/server/adapters/memory/http";
import {
  createLogger,
  ManualClock,
  memorySecrets,
  TokenBucketLimiter,
} from "@imo/server/adapters/memory/runtime";
import { feeFor } from "@imo/core/fees";
import { kalshi } from "../src/kalshi/manifest";
import {
  feeModel,
  listable,
  price,
  quantity,
  toBook,
  toCandles,
} from "../src/kalshi/mappers";
import { createKalshiSource, KALSHI_HOSTS } from "../src/kalshi/source";
import { defineVenueConformance } from "../src/sdk/conformance";

const dir = join(__dirname, "../src/kalshi/fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), "utf8"));
const B = KALSHI_HOSTS.demo;
const events = load("events-open.json");
const orderbook = load("orderbook.json");

/** Real demo recordings, replayed; per-ticker responses are built from the
    recorded events page so every market the listing names can be fetched. */
function recordings(): Recording[] {
  const markets = new Map<string, { market: unknown; event: unknown }>();
  for (const event of events.events)
    for (const market of event.markets ?? [])
      markets.set(market.ticker, { market, event });
  const ticker = (url: string, re: RegExp) =>
    decodeURIComponent(url.match(re)?.[1] ?? "");
  return [
    { url: `${B}/exchange/status`, body: load("exchange-status.json") },
    // Page one is the recording; its cursor leads to an empty last page.
    {
      url: /\/events\?status=open/,
      body: (url: string) =>
        new URL(url).searchParams.has("cursor")
          ? { events: [], cursor: "" }
          : events,
    },
    { url: /\/series\/[^/?]+$/, body: load("series.json") },
    { url: /\/series\/.+\/candlesticks\?/, body: load("candles.json") },
    {
      url: /\/markets\/__missing__$/,
      status: 404,
      body: { error: { code: "not_found" } },
    },
    {
      url: /\/markets\/orderbooks\?/,
      body: (url: string) => ({
        orderbooks: new URL(url).searchParams
          .getAll("tickers")
          .map((t) => ({ ticker: t, orderbook_fp: orderbook.orderbook_fp })),
      }),
    },
    { url: /\/markets\/trades\?/, body: load("trades.json") },
    {
      url: /\/markets\/[^/?]+$/,
      body: (url: string) => ({
        market: markets.get(ticker(url, /\/markets\/([^/?]+)$/))?.market,
      }),
    },
    {
      url: /\/events\/[^/?]+$/,
      body: (url: string) => {
        const id = ticker(url, /\/events\/([^/?]+)$/);
        const event = events.events.find(
          (e: { event_ticker: string }) => e.event_ticker === id,
        );
        return { event, markets: event?.markets ?? [] };
      },
    },
  ];
}

const context = () => {
  const clock = new ManualClock("2026-09-29T12:00:00Z");
  return {
    http: new ScriptedHttp(recordings()),
    rateLimiter: new TokenBucketLimiter(
      { "kalshi:read": { perSecond: 1_000_000, capacity: 1_000_000 } },
      clock,
    ),
    secrets: memorySecrets(),
    log: createLogger(() => {}),
    clock,
    config: {},
  };
};

defineVenueConformance({
  manifest: kalshi,
  create: () => createKalshiSource(context(), { env: "demo", pollMs: 50 }),
});

test("dollar strings and fixed-point counts convert exactly", () => {
  assert.equal(price("0.1400"), 140_000);
  assert.equal(price("0.0001"), 100);
  assert.equal(quantity("948.00"), 94_800);
  assert.equal(quantity("1.5"), 150);
});

test("bids-only books become two-sided, best first", () => {
  const book = toBook(
    "T",
    {
      yes_dollars: [
        ["0.0100", "948.00"],
        ["0.1400", "983.00"],
      ],
      no_dollars: [["0.8000", "10.00"]],
    },
    "2026-09-29T12:00:00Z",
  );
  const yes = book.outcomes.find((o) => o.outcome === "yes")!;
  const no = book.outcomes.find((o) => o.outcome === "no")!;
  assert.deepEqual(
    yes.bids.map((l) => l.price),
    [140_000, 10_000],
  );
  assert.deepEqual(
    yes.asks,
    [{ price: 200_000, quantity: 1_000 }],
    "No bid 0.80 = Yes ask 0.20",
  );
  assert.deepEqual(
    no.asks.map((l) => l.price),
    [860_000, 990_000],
  );
});

test("series fees scale by multiplier, and maker fees stay on makers", () => {
  const half = feeModel({
    ticker: "S",
    category: "",
    fee_type: "quadratic",
    fee_multiplier: 0.5,
  });
  assert.equal(half.kind === "quadratic" && half.rate, "0.035");
  const both = feeModel({
    ticker: "S",
    category: "",
    fee_type: "quadratic_with_maker_fees",
    fee_multiplier: 1,
  });
  const fill = {
    price: 500_000,
    quantity: 10_000,
    quantityScale: 2,
    currencyScale: 6,
  };
  assert.equal(feeFor(both, { ...fill, liquidity: "taker" }), 1_750_000);
  assert.equal(feeFor(both, { ...fill, liquidity: "maker" }), 437_500);
});

test("combo and scalar markets are not listed", () => {
  const base = {
    ticker: "A",
    event_ticker: "E",
    market_type: "binary",
    title: "t",
    status: "active",
    close_time: "2026-10-01T00:00:00Z",
  };
  assert.ok(listable(base as never));
  assert.ok(!listable({ ...base, market_type: "scalar" } as never));
  assert.ok(!listable({ ...base, mve_collection_ticker: "KXMVE-R" } as never));
  assert.ok(!listable({ ...base, event_ticker: "KXMVECROSS-1" } as never));
});

test("candles carry the last close through quiet periods", () => {
  const candles = toCandles(
    {
      candlesticks: [
        {
          end_period_ts: 7200,
          price: {
            open_dollars: "0.10",
            high_dollars: "0.12",
            low_dollars: "0.09",
            close_dollars: "0.11",
          },
        },
        {
          end_period_ts: 10800,
          price: {
            open_dollars: null,
            high_dollars: null,
            low_dollars: null,
            close_dollars: null,
          },
        },
      ],
    },
    3600,
  );
  assert.equal(candles.length, 2);
  assert.equal(candles[1].close, 110_000);
  assert.equal(candles[1].start, new Date(7200 * 1000).toISOString());
});
