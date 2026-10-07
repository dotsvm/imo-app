import { test } from "node:test";
import assert from "node:assert/strict";
import { People, YOU, toRoom } from "../src/client/normalize";
import { createApiServices } from "../src/client/store";
import { availableCash, bestAsk, bestBid } from "@imo/domain/engine";
import { arrowUsd, parseDollars, priceFor, signedPct, signedUsd, tone } from "@imo/domain/money";
import { complement } from "@imo/core/market";
import { meta } from "../src/components/ui";
import { placeIn, updatedLabel } from "@imo/domain/watchlists";
import type { DemoState, Market } from "@imo/domain/types";
import { markets } from "@imo/domain/demo/fixtures";

const fed = markets.find((m) => m.id === "fed-dec")!;

test("people are keyed the way screens address them", () => {
  const people = new People();
  people.setViewer("u-1", "jordan");
  assert.equal(people.remember({ id: "u-2", handle: "mirak" }), "mirak");
  assert.equal(people.key("u-1"), YOU);
  assert.equal(people.handle(YOU), "jordan", "API paths use the handle");
  assert.equal(people.id("mirak"), "u-2");
});

test("prices come from the live book when there is one", () => {
  const live = { ...fed, yesBid: 58, yesAsk: 61 } as Market;
  assert.deepEqual([bestBid(live, "Yes"), bestAsk(live, "Yes")], [58, 61]);
  assert.deepEqual([bestBid(live, "No"), bestAsk(live, "No")], [39, 42], "No is the complement of the other side");
  assert.deepEqual([bestBid(fed, "Yes"), bestAsk(fed, "Yes")], [62, 62], "without a book, the venue's own price: never an invented spread");
  assert.equal(priceFor(fed, "No"), 38);
});

test("available cash is what the server says is free", () => {
  const state = { cashCents: 100_000, reservedCents: 24_640, orders: [] } as unknown as DemoState;
  assert.equal(availableCash(state), 75_360);
});

test("money and list helpers", () => {
  assert.equal(parseDollars("100.1"), 10_010);
  for (const bad of ["-1", "1e3", "1.001", ""]) assert.equal(parseDollars(bad), null);
  assert.deepEqual(placeIn(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  const now = Date.parse("2026-09-29T08:00:00Z");
  assert.equal(updatedLabel("2026-09-28T23:00:00Z", now), "Updated yesterday");
});

test("a room shows you your own pending request, and moderators everyone's", () => {
  const people = new People();
  people.setViewer("u-1", "jordan");
  const summary = {
    id: "quiet-desk", name: "Quiet Desk", description: "", symbol: "QD",
    owner: { id: "u-9", handle: "cy", name: "Cy" }, privacy: "Invite only" as const,
    memberCount: 2, online: 0, postsToday: 0, role: null, requested: true, unread: 0,
    archived: false, watchlist: [], realtime: "room:r-1",
  };
  const { room } = toRoom(people, summary as never);
  assert.deepEqual(room.requests, [YOU]);
});

/** A fake API: answers by method and path; records what was asked. */
function fakeApi(routes: Record<string, (body: unknown) => [number, unknown]>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${String(input).split("?")[0]}`;
    calls.push(key);
    const handler = routes[key];
    const [status, body] = handler ? handler(init.body ? JSON.parse(String(init.body)) : undefined) : [404, { error: { code: "not_found", message: `No route ${key}` } }];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

test("the store signs the demo in, then undoes a change the server refuses", async () => {
  let signedIn = false;
  const empty = { items: [] };
  const calls = fakeApi({
    "GET /api/v1/config": () => [200, { auth: { dev: true }, realtime: { kind: "none" } }],
    "GET /api/v1/me": () =>
      signedIn
        ? [200, {
            user: { id: "u-1", handle: "jordan", displayName: "Jordan Reyes", bio: "", region: "", role: "user" },
            settings: { interests: [], onboarded: true, email: null, emailVerified: false, theme: "Midnight", priceInCents: true, showPositionsOnPosts: true, appearOnLeaderboard: true, privateOpenPositions: false },
            wallets: [],
            signIn: { method: "dev" },
            account: { cashCents: 100_000, reservedCents: 0 },
            access: { gated: false, granted: true },
          }]
        : [401, { error: { code: "unauthorized", message: "Sign in to continue." } }],
    "POST /api/v1/dev/session": () => {
      signedIn = true;
      return [200, { ok: true }];
    },
    "GET /api/v1/portfolio": () => [200, { account: { cashCents: 100_000, reservedCents: 0 }, positions: [], closed: [], claims: [] }],
    "GET /api/v1/portfolio/activity": () => [200, empty],
    "GET /api/v1/orders": () => [200, empty],
    "GET /api/v1/watchlists": () => [200, { items: [{ id: "w", name: "Saved markets", isDefault: true, marketIds: [], updatedAt: "2026-09-25T00:00:00Z" }] }],
    "GET /api/v1/me/following": () => [200, empty],
    "GET /api/v1/notifications": () => [200, { items: [], unread: 0 }],
    "GET /api/v1/me/notification-preferences": () => [200, empty],
    "GET /api/v1/alerts": () => [200, empty],
    "GET /api/v1/markets": () => [200, { items: [], next: undefined }],
    "GET /api/v1/posts": () => [200, { items: [], next: undefined }],
    "GET /api/v1/rooms": () => [200, empty],
    "GET /api/v1/traders": () => [200, empty],
    "GET /api/v1/leaderboard": () => [200, { items: [] }],
    "PUT /api/v1/watchlists/saved/markets/fed-dec": () => [500, { error: { code: "internal", message: "Something went wrong on our side." } }],
  });
  const store = createApiServices();
  await store.start();
  assert.ok(calls.includes("POST /api/v1/dev/session"), "the demo signed itself in");
  assert.equal(store.getSnapshot().settings.handle, "jordan");

  store.toggleWatchlist("fed-dec");
  assert.deepEqual(store.getSnapshot().watchlist, ["fed-dec"], "shown at once");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(store.getSnapshot().watchlist, [], "undone when the server refuses");
  assert.equal(store.problem(), "Something went wrong on our side.");
  store.stop();
});

test("numbers read cleanly: the other side's price, nothing gained, a line of facts", () => {
  // 100 − 99.3 in floating point is 0.7000000000000028; a price never shows that.
  assert.equal(complement(99.3), 0.7);
  assert.equal(complement(63.4), 36.6);
  assert.equal(complement(0.15), 99.85);
  assert.equal(complement(50), 50);
  const fractional = { ...markets[0], status: "open" as const, yesPrice: 99.3 } as Market;
  assert.equal(priceFor(fractional, "No"), 0.7);

  // Zero is neither a gain nor a loss: no sign, no arrow, no colour.
  assert.equal(signedUsd(0), "$0.00");
  assert.equal(arrowUsd(0), "$0.00");
  assert.equal(signedUsd(1234), "+$12.34");
  assert.equal(arrowUsd(-500), "▼ −$5.00");
  assert.deepEqual([tone(5), tone(-5), tone(0)], ["positive", "negative", ""]);
  assert.deepEqual([signedPct(2.34), signedPct(-1), signedPct(0)], ["+2.3%", "−1.0%", "0.0%"]);

  // An empty part leaves no dangling separator.
  assert.equal(meta("@ana", "", "12 resolved"), "@ana · 12 resolved");
  assert.equal(meta("", "64% right"), "64% right");
  assert.equal(meta(undefined, null, false, "only"), "only");
});
