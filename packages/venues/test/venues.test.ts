import { test } from "node:test";
import assert from "node:assert/strict";
import { defineVenueConformance } from "../src/sdk/conformance";
import { defineVenue, defaultFee, mapStatus } from "../src/sdk/manifest";
import { fixture } from "../src/fixture/manifest";
import { createFixtureVenue } from "../src/fixture/source";
import { kalshi } from "../src/kalshi/manifest";
import { polymarket } from "../src/polymarket/manifest";
import type { MarketDataEvent } from "../src/sdk/source";

defineVenueConformance({
  manifest: fixture,
  create: () => createFixtureVenue().source,
});

test("real venue manifests validate, and map every documented state", () => {
  for (const manifest of [kalshi, polymarket])
    assert.doesNotThrow(() => defineVenue(manifest));
  // Kalshi's REST states (docs.kalshi.com, market lifecycle).
  for (const state of [
    "initialized",
    "active",
    "inactive",
    "closed",
    "determined",
    "disputed",
    "amended",
    "finalized",
  ])
    assert.notEqual(mapStatus(kalshi, state), "unknown", state);
  assert.equal(mapStatus(kalshi, "finalized"), "resolved");
  assert.equal(mapStatus(kalshi, "something-new"), "unknown");
  assert.equal(defaultFee(polymarket, "geopolitics").kind, "none");
  assert.equal(
    defaultFee(polymarket, "not-a-category"),
    polymarket.fees.default,
  );
});

test("a bad manifest fails at definition, with every problem listed", () => {
  assert.throws(
    () =>
      defineVenue({
        ...fixture,
        id: "Bad Id",
        collateral: "NOPE",
        display: { ...fixture.display, mark: "LONG", color: "green" },
        statusMap: { live: "trading" as never },
      }),
    (error: Error) =>
      ["id", "collateral", "mark", "color", "statusMap.live"].every((part) =>
        error.message.includes(part),
      ),
  );
});

test("fixture controls publish canonical events to subscribers only", async () => {
  const { source, control } = createFixtureVenue();
  const seen: MarketDataEvent[] = [];
  const ref = { venueId: "fixture", externalId: "FX-RATES-DEC" };
  const subscription = source.stream!([ref], (event) => seen.push(event));
  await new Promise((resolve) => setTimeout(resolve, 0));
  control.setYes("FX-RATES-DEC", 70);
  control.setYes("FX-CPI-OCT", 10); // not subscribed
  control.setStatus("FX-RATES-DEC", "paused");
  control.setTrading(false, "2026-09-26T09:00:00Z");
  subscription.close();
  control.setYes("FX-RATES-DEC", 71); // after close
  assert.deepEqual(
    seen.map((e) => e.type),
    ["book.snapshot", "book.snapshot", "market.status", "venue.status"],
  );
  const snapshot = seen[1];
  assert.ok(snapshot.type === "book.snapshot");
  assert.equal(snapshot.book.outcomes[0].asks[0].price, 710_000);
  assert.throws(() => control.setStatus("FX-STORM", "open"), /not legal/);
});

test("resolving publishes a final result exactly once", async () => {
  const { source, control } = createFixtureVenue();
  control.setStatus("FX-CPI-OCT", "closed");
  control.resolve("FX-CPI-OCT", "yes");
  const market = await source.getMarket({
    venueId: "fixture",
    externalId: "FX-CPI-OCT",
  });
  assert.equal(market?.status, "resolved");
  assert.deepEqual(market?.resolution?.outcome, "yes");
  assert.throws(() => control.resolve("FX-CPI-OCT", "no"), /not legal/);
});
