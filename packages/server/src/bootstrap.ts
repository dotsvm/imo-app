/**
 * Idempotent startup: the registry rows the platform needs (venues from the
 * catalog, the paper route). Safe to run on every boot of web and worker;
 * operational changes made later (stage, display rights) are never
 * overwritten.
 */
import { sql } from "drizzle-orm";
import { VENUE_CATALOG } from "@imo/venues/catalog";
import { fixture } from "@imo/venues/fixture/manifest";
import { WALLET_VENUES } from "@imo/venues/execution-catalog";
import { APP_FEE_MODEL, NO_APP_FEE, PAPER_ROUTE, WALLET_ROUTE } from "./catalogs";
import { DEFAULT_CATEGORY_MAP } from "./categories";
import type { Db } from "./db/client";
import { categoryMap, executionRoutes, routeVenues, venues } from "./db/schema";

export async function bootstrap(
  db: Db,
  options: { withFixture?: boolean } = {},
) {
  const entries = [
    ...VENUE_CATALOG.map((entry, position) => ({
      id: entry.manifest.id,
      stage: entry.rollout.stage,
      summary: entry.rollout.summary,
      displayAllowed: entry.manifest.dataRights.display,
      position,
    })),
    ...(options.withFixture
      ? [
          {
            id: fixture.id,
            stage: "paper" as const,
            summary: "Test venue",
            displayAllowed: true,
            position: 99,
          },
        ]
      : []),
  ];
  await db.insert(venues).values(entries).onConflictDoNothing();
  await db
    .insert(executionRoutes)
    .values({
      id: PAPER_ROUTE,
      mode: "paper",
      accountModel: "none",
      fee: APP_FEE_MODEL,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: executionRoutes.id,
      set: { fee: APP_FEE_MODEL, updatedAt: sql`now()` },
    });
  await db
    .insert(routeVenues)
    .values(
      entries.map((venue) => ({ routeId: PAPER_ROUTE, venueId: venue.id })),
    )
    .onConflictDoNothing();
  // Wallet trading: venues whose module trades from the trader's own wallet.
  await db
    .insert(executionRoutes)
    .values({ id: WALLET_ROUTE, mode: "live", accountModel: "wallet", fee: NO_APP_FEE, enabled: true })
    .onConflictDoUpdate({ target: executionRoutes.id, set: { fee: NO_APP_FEE, updatedAt: sql`now()` } });
  const walletVenues = entries.filter((e) => WALLET_VENUES.includes(e.id));
  if (walletVenues.length)
    await db
      .insert(routeVenues)
      .values(walletVenues.map((venue) => ({ routeId: WALLET_ROUTE, venueId: venue.id })))
      .onConflictDoNothing();
  // Default category mappings; rows an admin changed are left alone.
  const known = new Set(entries.map((e) => e.id));
  const mappings = Object.entries(DEFAULT_CATEGORY_MAP).flatMap(
    ([venueId, map]) =>
      known.has(venueId)
        ? Object.entries(map).map(([venueCategory, category]) => ({
            venueId,
            venueCategory,
            category,
          }))
        : [],
  );
  if (mappings.length)
    await db.insert(categoryMap).values(mappings).onConflictDoNothing();
}
