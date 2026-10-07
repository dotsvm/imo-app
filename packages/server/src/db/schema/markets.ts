/** Canonical markets, as every venue module maps them (packages/core/src/market.ts). */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FeeModel } from "@imo/core/fees";
import { MARKET_STATUSES } from "@imo/core/lifecycle";
import type { PriceRange, Resolution } from "@imo/core/market";
import { createdAt, id, oneOf, ref, units, updatedAt, when } from "./columns";
import { venues } from "./registry";

export const events = pgTable(
  "events",
  {
    id: id(),
    venueId: text()
      .notNull()
      .references(() => venues.id),
    externalId: text().notNull(),
    title: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_external").on(t.venueId, t.externalId)],
);

export const markets = pgTable(
  "markets",
  {
    id: id(),
    /** Stable, human-readable URL key: /market/fed-dec. */
    slug: text().notNull(),
    venueId: text()
      .notNull()
      .references(() => venues.id),
    externalId: text().notNull(),
    /** The data source that feeds this market — not always the venue's own
        API (a licensed aggregator, the demo dataset, the fixture). */
    source: text().notNull(),
    eventId: ref().references(() => events.id),
    type: text({ enum: ["binary", "categorical", "scalar"] }).notNull(),
    title: text().notNull(),
    shortTitle: text().notNull(),
    description: text().notNull().default(""),
    rules: text().notNull(),
    resolutionSource: text().notNull().default(""),
    /** One of Hunch's categories, from the category map (or an override). */
    category: text().notNull(),
    categoryHints: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text({ enum: MARKET_STATUSES }).notNull(),
    currency: text().notNull(),
    tick: units().notNull(),
    /** Tiered ticks (Kalshi's price_ranges), when one tick doesn't fit all. */
    priceRanges: jsonb().$type<PriceRange[]>(),
    quantityScale: integer().notNull().default(0),
    quantityStep: units().notNull().default(1),
    venueFee: jsonb().$type<FeeModel>().notNull(),
    opensAt: when(),
    closesAt: when().notNull(),
    expectedResolutionAt: when(),
    resolution: jsonb().$type<Resolution>(),
    volume: units().notNull().default(0),
    volume24h: units().notNull().default(0),
    openInterest: units().notNull().default(0),
    liquidity: units().notNull().default(0),
    /** Venue-side trader count, when the venue publishes one. */
    traders: integer().notNull().default(0),
    featured: boolean().notNull().default(false),
    /** The editorial line over a featured market: "FOMC week". */
    featuredLabel: text(),
    hidden: boolean().notNull().default(false),
    /** Hash of the listing's descriptive fields: an unchanged listing skips
        the write. Prices and volumes update in bulk, apart from this. */
    contentHash: text(),
    /** When the source last listed this market. One that drops out of the
        listing is looked up on its own, so its final result is never missed. */
    seenAt: when(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("markets_slug").on(t.slug),
    uniqueIndex("markets_external").on(t.venueId, t.externalId),
    index("markets_status_closes").on(t.status, t.closesAt),
    index("markets_category").on(t.category),
    index("markets_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
    check("markets_status", oneOf("status", MARKET_STATUSES)),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    marketId: ref()
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    key: text().notNull(),
    label: text().notNull(),
    index: integer().notNull(),
    externalId: text(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.key] })],
);

/** The latest quote per market, refreshed by the worker within each venue's
    data-rights TTL. Prices are minor units per share; `series` is the 7-day
    Yes path the cards draw. */
export const marketQuotes = pgTable("market_quotes", {
  marketId: ref()
    .primaryKey()
    .references(() => markets.id, { onDelete: "cascade" }),
  yesBid: units(),
  yesAsk: units(),
  last: units(),
  /** Change in the Yes price over 24 hours, in minor units. */
  change24h: units().notNull().default(0),
  series: jsonb()
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  source: text().notNull(),
  updatedAt: updatedAt(),
});

export const marketTrending = pgTable("market_trending", {
  marketId: ref()
    .primaryKey()
    .references(() => markets.id, { onDelete: "cascade" }),
  score: doublePrecision().notNull(),
  rank: integer().notNull(),
  computedAt: when().notNull().defaultNow(),
});

/** Hunch's own holders per side, for "who's on each side". */
export const marketHolders = pgTable("market_holders", {
  marketId: ref()
    .primaryKey()
    .references(() => markets.id, { onDelete: "cascade" }),
  yes: integer().notNull().default(0),
  no: integer().notNull().default(0),
  yesShare: real().notNull().default(0),
  updatedAt: updatedAt(),
});
