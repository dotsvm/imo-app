/**
 * Jupiter Predict conformance on payloads recorded from the live API
 * (api.jup.ag/prediction/v1, October 7, 2026), trimmed to a few events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedHttp, type Recording } from "@imo/server/adapters/memory/http";
import { createLogger, ManualClock, memorySecrets, TokenBucketLimiter } from "@imo/server/adapters/memory/runtime";
import { jupiter } from "../src/jupiter/manifest";
import { feeModel, statusOf, toBook, toCanonicalMarket } from "../src/jupiter/mappers";
import { JupiterEvent, JupiterMarket, Orderbook } from "../src/jupiter/schemas";
import { createJupiterSource } from "../src/jupiter/source";
import { defineVenueConformance } from "../src/sdk/conformance";
import eventsKalshi from "../src/jupiter/fixtures/events-kalshi.json";
import eventsPolymarket from "../src/jupiter/fixtures/events-polymarket.json";
import orderbook from "../src/jupiter/fixtures/orderbook.json";
import market from "../src/jupiter/fixtures/market.json";
import event from "../src/jupiter/fixtures/event.json";
import tradingStatus from "../src/jupiter/fixtures/trading-status.json";

/** Every recorded event and market, so /markets/{id} and /events/{id} answer by id. */
const allEvents = [...eventsKalshi.data, ...eventsPolymarket.data] as { eventId: string; markets: { marketId: string }[] }[];
const lastSegment = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop()!);

const recordings = (): Recording[] => [
  { url: /\/events\?provider=kalshi&/, body: eventsKalshi },
  { url: /\/events\?provider=polymarket&/, body: eventsPolymarket },
  { url: /\/orderbook\//, body: orderbook },
  // The live API answers an unknown market with a 404.
  { url: /\/markets\/__missing__$/, status: 404, body: { type: "not_found_error" } },
  {
    url: /\/markets\//,
    body: (url: string) => {
      const id = lastSegment(url);
      const owner = allEvents.find((e) => e.markets.some((m) => m.marketId === id));
      const found = owner?.markets.find((m) => m.marketId === id);
      return found ? { ...found, eventId: owner!.eventId } : market;
    },
  },
  {
    url: /\/events\/[^?]+$/,
    body: (url: string) => {
      const found = allEvents.find((e) => e.eventId === lastSegment(url));
      return found ? { ...found, markets: undefined } : event;
    },
  },
  { url: /\/trading-status$/, body: tradingStatus },
];

const context = () => {
  const clock = new ManualClock("2026-10-07T05:00:00Z");
  return {
    http: new ScriptedHttp(recordings()),
    rateLimiter: new TokenBucketLimiter({ "jupiter:read": { perSecond: 1e6, capacity: 1e6 } }, clock),
    secrets: memorySecrets(),
    log: createLogger(() => {}),
    clock,
    config: {},
  };
};

defineVenueConformance({
  manifest: jupiter,
  create: () => createJupiterSource(context(), { pollMs: 50 }),
});

const firstEvent = JupiterEvent.parse(eventsKalshi.data[0]);
const parse = (raw: unknown) => JupiterMarket.parse(raw);

test("lists every provider's events, Kalshi first, then Polymarket", async () => {
  const source = createJupiterSource(context());
  const first = await source.listMarkets();
  assert.equal(first.next, "1:0", "after Kalshi's last page comes Polymarket's first");
  assert.ok(first.items.length > 0);
  assert.ok(first.items.every((m) => m.ref.venueId === "jupiter"));
  const second = await source.listMarkets(first.next);
  assert.equal(second.next, undefined, "Polymarket is the last provider");
  assert.ok(second.items.some((m) => m.ref.externalId.startsWith("POLY-")));
});

test("micro-USD pricing becomes the Yes bid and ask", () => {
  const m = toCanonicalMarket(parse(market), JupiterEvent.parse(event))!;
  assert.equal(m.snapshot?.yesAsk, market.pricing.buyYesPriceUsd);
  assert.equal(m.snapshot?.yesBid, market.pricing.sellYesPriceUsd);
  assert.equal(m.currency, "USDC");
  assert.ok(Date.parse(m.closesAt) > 0);
});

test("a market inside a multi-market event is named by event and option", () => {
  const raw = parse(firstEvent.markets![0]);
  const m = toCanonicalMarket(raw, firstEvent)!;
  assert.ok(m.title.startsWith(firstEvent.metadata!.title!), m.title);
  assert.equal(m.shortTitle, raw.title);
  assert.ok(m.categoryHints.includes(firstEvent.category!));
});

test("books: bids best-first, and the other side's bids become asks", () => {
  const b = toBook("SENATETX-26-D", Orderbook.parse(orderbook), "2026-10-07T05:00:00Z");
  const [yes, no] = b.outcomes;
  assert.ok(yes!.bids.every((l, i) => i === 0 || l.price < yes!.bids[i - 1]!.price), "bids descend");
  assert.ok(yes!.asks.every((l, i) => i === 0 || l.price > yes!.asks[i - 1]!.price), "asks ascend");
  assert.ok(yes!.bids.every((l) => l.price > 0 && l.price < 1_000_000 && l.quantity > 0), "no zero-price levels");
  const bestNoBid = no!.bids[0]?.price;
  if (bestNoBid !== undefined) assert.equal(yes!.asks[0]?.price, 1_000_000 - bestNoBid);
});

test("results and cancellations settle", () => {
  const base = parse(market);
  assert.equal(statusOf({ ...base, status: "closed", result: "yes" }), "resolved");
  assert.equal(statusOf({ ...base, status: "closed", result: null }), "closed");
  assert.equal(statusOf({ ...base, status: "cancelled", result: null }), "voided");
  const won = toCanonicalMarket({ ...base, status: "closed", result: "no" }, undefined)!;
  assert.deepEqual([won.status, won.resolution?.outcome, won.resolution?.final], ["resolved", "no", true]);
});

test("fees follow the source: Kalshi's rate, or twice Polymarket's", () => {
  const kalshiFee = feeModel({ ...parse(market), provider: "kalshi" }, undefined);
  assert.equal(kalshiFee.kind === "quadratic" && kalshiFee.rate, "0.07");
  const polyFee = feeModel({ ...parse(market), provider: "polymarket" }, { ...firstEvent, category: "crypto" });
  assert.equal(polyFee.kind === "quadratic" && polyFee.rate, "0.14");
});

test("head-to-head lines (no Yes/No) aren't listed", () => {
  assert.equal(toCanonicalMarket({ ...parse(market), outcomes: ["Team A", "Team B"] }, undefined), null);
});
