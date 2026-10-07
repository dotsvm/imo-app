import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { GET as list } from "../../src/app/api/v1/markets/route";
import { GET as detail } from "../../src/app/api/v1/markets/[slug]/route";
import { GET as book } from "../../src/app/api/v1/markets/[slug]/book/route";
import { GET as trades } from "../../src/app/api/v1/markets/[slug]/trades/route";
import { GET as candles } from "../../src/app/api/v1/markets/[slug]/candles/route";
import { resetDatabase } from "./helpers";

const deps = () => getServerDeps();
const get = async (
  handler: typeof list,
  path: string,
  params: Record<string, string> = {},
) => {
  const res = await handler(
    new NextRequest(`http://localhost${path}`, {
      headers: { "x-forwarded-for": "10.1.1.1" },
    }),
    {
      params: Promise.resolve(params),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
};
type Item = {
  id: string;
  category: string;
  volumeCents: number;
  closesAt: string;
  change: number;
  status: string;
};

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
});
after(async () => deps().database?.close());

test("the catalog pages in the curated order, open markets only by default", async () => {
  const first = await get(list, "/api/v1/markets?limit=5");
  const items = first.body.items as Item[];
  assert.deepEqual(items.map((m) => m.id).slice(0, 3), [
    "fed-dec",
    "cpi-oct",
    "btc",
  ]);
  assert.ok(items.every((m) => m.status === "open"));
  const second = await get(
    list,
    `/api/v1/markets?limit=5&cursor=${first.body.next}`,
  );
  const ids = new Set(
    [...items, ...(second.body.items as Item[])].map((m) => m.id),
  );
  assert.equal(ids.size, 10, "pages don't overlap");
});

test("filters and sorts compose", async () => {
  const crypto = (
    await get(list, "/api/v1/markets?category=Crypto&sort=volume")
  ).body.items as Item[];
  assert.ok(crypto.length > 0 && crypto.every((m) => m.category === "Crypto"));
  assert.ok(
    crypto.every(
      (m, i) => i === 0 || crypto[i - 1].volumeCents >= m.volumeCents,
    ),
  );
  const closing = (await get(list, "/api/v1/markets?sort=closing&limit=10"))
    .body.items as Item[];
  assert.ok(
    closing.every(
      (m, i) =>
        i === 0 ||
        Date.parse(closing[i - 1].closesAt) <= Date.parse(m.closesAt),
    ),
  );
  const movers = (await get(list, "/api/v1/markets?sort=movers&limit=10")).body
    .items as Item[];
  assert.ok(
    movers.every(
      (m, i) => i === 0 || Math.abs(movers[i - 1].change) >= Math.abs(m.change),
    ),
  );
  const resolved = (await get(list, "/api/v1/markets?status=resolved")).body
    .items as Item[];
  assert.ok(
    resolved.length >= 2 && resolved.every((m) => m.status === "resolved"),
  );
  const byIds = (await get(list, "/api/v1/markets?ids=btc,fed-dec")).body
    .items as Item[];
  assert.deepEqual(
    byIds.map((m) => m.id),
    ["btc", "fed-dec"],
    "ids keep the caller's order",
  );
  const search = (await get(list, "/api/v1/markets?q=fed")).body
    .items as Item[];
  assert.equal(search[0].id, "fed-dec");
});

test("a market reads like the UI's record, in cents", async () => {
  const { status, body } = await get(detail, "/api/v1/markets/fed-dec", {
    slug: "fed-dec",
  });
  assert.equal(status, 200);
  assert.equal(body.yesPrice, 62);
  assert.equal(body.venueId, "kalshi");
  assert.deepEqual(body.holders, {
    yes: (body.holders as { yes: number }).yes,
    no: (body.holders as { no: number }).no,
  });
  assert.equal(
    (body.series as number[]).at(-1),
    62,
    "the 7-day path ends on the price",
  );
  assert.equal(
    (await get(detail, "/api/v1/markets/nope", { slug: "nope" })).status,
    404,
  );
});

test("book, tape and history come from the market's data source", async () => {
  const b = (
    await get(book, "/api/v1/markets/fed-dec/book", { slug: "fed-dec" })
  ).body as {
    bids: { priceCents: number; depthPercent: number }[];
    asks: { priceCents: number }[];
    live: boolean;
  };
  assert.ok(b.live);
  assert.equal(b.bids[0].priceCents, 61);
  assert.equal(b.asks[0].priceCents, 63);
  assert.ok(b.bids.some((l) => l.depthPercent === 100));
  const tape = (
    await get(trades, "/api/v1/markets/fed-dec/trades", { slug: "fed-dec" })
  ).body.items as {
    shares: number;
    priceCents: number;
    minutesAgo: number;
  }[];
  assert.deepEqual(
    [tape[0].shares, tape[0].priceCents, tape[0].minutesAgo],
    [153, 63, 1],
  );
  const history = (
    await get(candles, "/api/v1/markets/fed-dec/candles?range=1W", {
      slug: "fed-dec",
    })
  ).body.points as {
    yes: number;
  }[];
  assert.equal(history.at(-1)!.yes, 62);
});

test("a venue that doesn't answer is unavailable (503), not our crash", async () => {
  const { HttpError } = await import("@imo/core/ports/runtime");
  const { markets } = await import("@imo/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await deps().db.select({ source: markets.source }).from(markets).where(eq(markets.slug, "fed-dec"));
  const source = deps().venues.sources.get(row.source)!;
  const getBooks = source.getBooks;
  source.getBooks = async () => {
    throw new HttpError(502, "https://venue.example/books");
  };
  try {
    const res = await get(book, "/api/v1/markets/fed-dec/book", { slug: "fed-dec" });
    assert.equal(res.status, 503);
    assert.equal((res.body as { error: { code: string } }).error.code, "unavailable");
  } finally {
    source.getBooks = getBooks;
  }
});
