/** Venues, data sources and execution routes: operational state in rows, so a
    new venue is data plus a module — never a migration. */
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type { FeeModel } from "@imo/core/fees";
import { oneOf, updatedAt, when } from "./columns";

export const ROLLOUT_STAGES = [
  "planned",
  "coming-soon",
  "data-only",
  "paper",
  "live",
] as const;

export const venues = pgTable(
  "venues",
  {
    id: text().primaryKey(),
    stage: text({ enum: ROLLOUT_STAGES }).notNull().default("planned"),
    /** Written consent to show this venue's data; overrides the manifest. */
    displayAllowed: boolean().notNull().default(false),
    summary: text().notNull().default(""),
    position: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  () => [check("venues_stage", oneOf("stage", ROLLOUT_STAGES))],
);

export const dataSources = pgTable("data_sources", {
  id: text().primaryKey(),
  venueId: text()
    .notNull()
    .references(() => venues.id),
  /** Lower wins; the next one takes over when the active source is unhealthy. */
  priority: integer().notNull().default(0),
  enabled: boolean().notNull().default(false),
  health: jsonb().$type<{
    stalenessMs?: number;
    errorRate?: number;
    checkedAt?: string;
  }>(),
  updatedAt: updatedAt(),
});

export const executionRoutes = pgTable(
  "execution_routes",
  {
    id: text().primaryKey(),
    mode: text({ enum: ["paper", "live"] }).notNull(),
    accountModel: text({
      enum: ["none", "api-key", "oauth", "wallet", "broker"],
    })
      .notNull()
      .default("none"),
    /** The route's own fee (the app fee), charged on every fill it routes. */
    fee: jsonb().$type<FeeModel>().notNull(),
    enabled: boolean().notNull().default(false),
    updatedAt: updatedAt(),
  },
  () => [check("routes_mode", oneOf("mode", ["paper", "live"]))],
);

/** Which venues a route can reach. */
export const routeVenues = pgTable(
  "route_venues",
  {
    routeId: text()
      .notNull()
      .references(() => executionRoutes.id),
    venueId: text()
      .notNull()
      .references(() => venues.id),
  },
  (t) => [primaryKey({ columns: [t.routeId, t.venueId] })],
);

/** A venue's own category or tag → one of Hunch's categories. */
export const categoryMap = pgTable(
  "category_map",
  {
    venueId: text()
      .notNull()
      .references(() => venues.id),
    venueCategory: text().notNull(),
    category: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.venueId, t.venueCategory] })],
);

export const venueStatus = pgTable("venue_status", {
  venueId: text()
    .primaryKey()
    .references(() => venues.id),
  exchangeActive: boolean().notNull().default(true),
  tradingActive: boolean().notNull().default(true),
  resumesAt: when(),
  checkedAt: when().notNull().defaultNow(),
});
