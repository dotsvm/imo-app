/**
 * Live smoke test for a venue source: list a page, fetch books, candles,
 * trades and status through the production HTTP client. Usage:
 *   npx tsx packages/server/scripts/smoke-venue.ts kalshi-demo | kalshi-direct | polymarket-public
 * Run it where the venue is reachable (e.g. on the worker's host).
 */
import { createFetchClient } from "../src/adapters/http/fetch-client";
import {
  createLogger,
  memorySecrets,
  systemClock,
  TokenBucketLimiter,
} from "../src/adapters/memory/runtime";
import { RATE_BUDGETS } from "../src/composition";
import { loadConfig } from "../src/composition/config";
import { createKalshiSource } from "@imo/venues/kalshi/source";
import { createPolymarketSource } from "@imo/venues/polymarket/source";

const which = process.argv[2] ?? "kalshi-demo";
const log = createLogger(
  (line) => line.level !== "debug" && console.log(JSON.stringify(line)),
  { level: "info" },
);
const config = loadConfig();
const ctx = {
  http: createFetchClient({
    allow: config.EGRESS_ALLOW,
    log,
    clock: systemClock,
  }),
  rateLimiter: new TokenBucketLimiter(RATE_BUDGETS, systemClock),
  secrets: memorySecrets(),
  log,
  clock: systemClock,
  config: {},
};
const source =
  which === "kalshi-demo"
    ? createKalshiSource(ctx, { env: "demo" })
    : which === "kalshi-direct"
      ? createKalshiSource(ctx, { env: "production" })
      : which === "polymarket-public"
        ? createPolymarketSource(ctx)
        : undefined;
if (!source) throw new Error(`Unknown source ${which}`);
const live = source;

async function main() {
  const started = Date.now();
  const status = await live.status();
  const page = await live.listMarkets();
  const open = page.items.filter((m) => m.status === "open").slice(0, 3);
  const books = await live.getBooks(open.map((m) => m.ref));
  const candles = open[0]
    ? await live.getCandles!(open[0].ref, {
        interval: "1h",
        from: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        to: new Date().toISOString(),
      })
    : [];
  const trades = open[0] && live.getTrades ? await live.getTrades(open[0].ref) : [];
  const again = open[0] ? await live.getMarket(open[0].ref) : undefined;
  console.log(
    JSON.stringify(
      {
        source: which,
        ms: Date.now() - started,
        trading: status.tradingActive,
        listed: page.items.length,
        more: !!page.next,
        sample: open.map((m) => ({
          id: m.ref.externalId,
          title: m.title.slice(0, 50),
          cat: m.categoryHints,
          fee: m.venueFee.kind,
          tick: m.tick,
          closes: m.closesAt,
          volume: m.stats?.volume,
        })),
        books: books.map((b) => ({
          id: b.ref.externalId,
          yesBid: b.outcomes[0].bids[0]?.price,
          yesAsk: b.outcomes[0].asks[0]?.price,
        })),
        candles: candles.length,
        lastCandle: candles.at(-1),
        trades: trades.length,
        lastTrade: trades[0],
        refetched: again?.ref.externalId === open[0]?.ref.externalId,
      },
      null,
      1,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
