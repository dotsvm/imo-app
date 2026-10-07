/**
 * Polymarket conformance on payloads shaped like the documented REST examples
 * (docs.polymarket.com, September 2026). This network can't reach the live
 * API; re-record from a region that can and these tests stay the same.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedHttp, type Recording } from "@imo/server/adapters/memory/http";
import {
  createLogger,
  ManualClock,
  memorySecrets,
  TokenBucketLimiter,
} from "@imo/server/adapters/memory/runtime";
import { polymarket } from "../src/polymarket/manifest";
import {
  feeModel,
  statusOf,
  toBook,
  toCandles,
  toCanonicalMarket,
} from "../src/polymarket/mappers";
import { GammaMarket, PriceHistory } from "../src/polymarket/schemas";
import {
  createPolymarketSource,
  POLYMARKET_HOSTS,
} from "../src/polymarket/source";
import { defineVenueConformance } from "../src/sdk/conformance";

const YES =
  "107505882767731489358349912513945399560393482969656700824895970500493757150417";
const NO =
  "7305630249804085635496399869905769372294302716159034447326228509068694952392";
const OPEN = {
  id: "703257",
  question: "Will the US confirm that aliens exist before 2027?",
  conditionId:
    "0x747dc809fb79e1b05be09c42d6179459a58de2ef3e40f02484a4e1260f741f75",
  slug: "will-the-us-confirm-that-aliens-exist-before-2027-789-924-249",
  description: "Resolves Yes if the US government confirms…",
  endDate: "2026-12-31T00:00:00Z",
  active: true,
  closed: false,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.09", "0.91"]',
  clobTokenIds: JSON.stringify([YES, NO]),
  orderPriceMinTickSize: 0.01,
  volumeNum: 1250000.5,
  tags: [{ slug: "science", label: "Science" }],
};
const RESOLVED = {
  ...OPEN,
  id: "700001",
  question: "Did it happen?",
  conditionId: "0xresolved",
  closed: true,
  umaResolutionStatus: "resolved",
  outcomePrices: '["0", "1"]',
  clobTokenIds: JSON.stringify(["111", "222"]),
  tags: [{ slug: "crypto" }],
};
const SPORTS = {
  ...OPEN,
  id: "9",
  conditionId: "0xsports",
  outcomes: '["Team A", "Team B"]',
};
const BROKEN = { id: "10", question: 42 };

const book = (
  asset: string,
  bids: [string, string][],
  asks: [string, string][],
) => ({
  market: OPEN.conditionId,
  asset_id: asset,
  timestamp: "1782753357257",
  // The CLOB lists bids ascending and asks descending: best last.
  bids: bids.map(([price, size]) => ({ price, size })),
  asks: asks.map(([price, size]) => ({ price, size })),
  tick_size: "0.01",
  min_order_size: "5",
  last_trade_price: "0.090",
});

function recordings(): Recording[] {
  const markets: Record<string, unknown>[] = [OPEN, RESOLVED, SPORTS, BROKEN];
  return [
    {
      url: /\/markets\/keyset\?/,
      body: (url: string) =>
        new URL(url).searchParams.has("after_cursor")
          ? { markets: [], next_cursor: null }
          : { markets, next_cursor: "page-2" },
    },
    {
      url: /\/markets\?condition_ids=/,
      body: (url: string) =>
        markets.filter(
          (m) =>
            m.conditionId === new URL(url).searchParams.get("condition_ids"),
        ),
    },
    {
      method: "POST",
      url: `${POLYMARKET_HOSTS.clob}/books`,
      body: [
        book(
          YES,
          [
            ["0.01", "2116131.59"],
            ["0.02", "139963.89"],
            ["0.08", "33343.4"],
          ],
          [
            ["0.99", "93442.27"],
            ["0.98", "13229.55"],
            ["0.09", "163939.58"],
          ],
        ),
        book(
          NO,
          [
            ["0.01", "500"],
            ["0.91", "1000"],
          ],
          [
            ["0.99", "750"],
            ["0.92", "800"],
          ],
        ),
        book("111", [], []),
        book("222", [], []),
      ],
    },
    {
      url: /\/v2\/prices-history\?/,
      body: {
        history: [
          { t: 1790100000, p: 0.08 },
          { t: 1790103600, p: "0.09" },
        ],
      },
    },
    {
      url: /\/trades\?/,
      body: [
        {
          asset: YES,
          side: "BUY",
          size: "10",
          price: "0.09",
          timestamp: 1790103600,
        },
      ],
    },
  ];
}

const context = () => {
  const clock = new ManualClock("2026-09-29T12:00:00Z");
  return {
    http: new ScriptedHttp(recordings()),
    rateLimiter: new TokenBucketLimiter(
      { "polymarket:read": { perSecond: 1e6, capacity: 1e6 } },
      clock,
    ),
    secrets: memorySecrets(),
    log: createLogger(() => {}),
    clock,
    config: {},
  };
};

defineVenueConformance({
  manifest: polymarket,
  create: () => createPolymarketSource(context(), { pollMs: 50 }),
});

test("reversed CLOB arrays come out best-first on both sides", () => {
  const b = toBook(
    "c",
    book(
      "y",
      [
        ["0.01", "1"],
        ["0.08", "2"],
      ],
      [
        ["0.99", "1"],
        ["0.09", "2"],
      ],
    ),
    undefined,
    "2026-09-29T12:00:00Z",
  );
  assert.deepEqual(
    b.outcomes[0].bids.map((l) => l.price),
    [80_000, 10_000],
  );
  assert.deepEqual(
    b.outcomes[0].asks.map((l) => l.price),
    [90_000, 990_000],
  );
});

test("only Yes/No markets list; resolutions read the payout vector", () => {
  assert.equal(toCanonicalMarket(GammaMarket.parse(SPORTS)), null);
  const resolved = toCanonicalMarket(GammaMarket.parse(RESOLVED))!;
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.resolution, { outcome: "no", final: true });
  const split = toCanonicalMarket(
    GammaMarket.parse({ ...RESOLVED, outcomePrices: '["0.5", "0.5"]' }),
  )!;
  assert.equal(split.resolution?.outcome, "void");
  assert.equal(
    statusOf(GammaMarket.parse({ ...OPEN, acceptingOrders: false })),
    "paused",
  );
});

test("fees: the market's own rate, else its category's, else the default", () => {
  const own = feeModel(GammaMarket.parse({ ...OPEN, takerFeeRate: "0.03" }));
  assert.equal(own.kind === "quadratic" && own.rate, "0.03");
  const crypto = feeModel(GammaMarket.parse(RESOLVED));
  assert.equal(crypto.kind === "quadratic" && crypto.rate, "0.07");
  const geo = feeModel(
    GammaMarket.parse({ ...OPEN, tags: [{ slug: "geopolitics" }] }),
  );
  assert.equal(geo.kind, "none");
  assert.equal(
    feeModel(GammaMarket.parse({ ...OPEN, feesEnabled: false })).kind,
    "none",
  );
});

test("price history reads both documented point shapes, oldest first", () => {
  const hour = 3_600;
  const candles = toCandles(
    PriceHistory.parse({
      history: [
        { timestamp: "2026-09-29T12:00:00Z", price: "0.41" },
        { t: 1_790_676_000, p: 0.4 },
        { timestamp: 1_790_690_400_000, price: 0.42 },
        { note: "no time or price" },
      ],
    }),
    hour,
  );
  assert.deepEqual(
    candles.map((c) => [c.start, c.close]),
    [
      ["2026-09-29T09:00:00.000Z", 400_000],
      ["2026-09-29T11:00:00.000Z", 410_000],
      ["2026-09-29T13:00:00.000Z", 420_000],
    ],
  );
});

test("a market closes when it says, else on its date or its event's; with no date it isn't listed", () => {
  const without = { ...OPEN, endDate: undefined };
  assert.equal(toCanonicalMarket(GammaMarket.parse({ ...without, endDateIso: "2026-11-03" }))?.closesAt, "2026-11-03T00:00:00.000Z");
  assert.equal(
    toCanonicalMarket(GammaMarket.parse({ ...without, events: [{ id: "1", endDate: "2026-11-04T12:00:00Z" }] }))?.closesAt,
    "2026-11-04T12:00:00.000Z",
  );
  assert.equal(toCanonicalMarket(GammaMarket.parse({ ...without, events: [] })), null, "never an invented date");
});
