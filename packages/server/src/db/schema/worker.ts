/** Worker coordination: which replica runs a lane, and which markets people
    are looking at right now. */
import { doublePrecision, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { ref, updatedAt, when } from "./columns";
import { markets } from "./markets";

/**
 * One holder per lane at a time. A replica takes a lease that has run out,
 * renews its own, and loses it by going quiet — no connection-bound locks, so
 * it works through a transaction pooler.
 */
export const workerLeases = pgTable("worker_leases", {
  lane: text().primaryKey(),
  holder: text().notNull(),
  until: when().notNull(),
  updatedAt: updatedAt(),
});

/** Markets someone has open. Their books refresh every few seconds and
    stream to viewers until the interest lapses. */
export const marketInterest = pgTable("market_interest", {
  marketId: ref()
    .primaryKey()
    .references(() => markets.id, { onDelete: "cascade" }),
  until: when().notNull(),
});

/** The cache port on Postgres, for deployments without Redis. Unlogged:
    losing it in a crash only costs a recomputation. */
export const cacheEntries = pgTable(
  "cache_entries",
  {
    key: text().primaryKey(),
    value: jsonb().$type<unknown>().notNull(),
    expiresAt: when().notNull(),
  },
  (t) => [index("cache_entries_expiry").on(t.expiresAt)],
);

/** Token buckets shared by every instance: API budgets and venue budgets. */
export const rateBuckets = pgTable("rate_buckets", {
  key: text().primaryKey(),
  tokens: doublePrecision().notNull(),
  updatedAt: when().notNull(),
});
