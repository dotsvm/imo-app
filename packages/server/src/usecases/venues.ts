/** Listed venues: static facts from each manifest, rollout from the registry. */
import { asc } from "drizzle-orm";
import { VENUE_CATALOG } from "@imo/venues/catalog";
import type { Db } from "../db/client";
import * as t from "../db/schema";

export async function listVenues(db: Db) {
  const rows = await db.select().from(t.venues).orderBy(asc(t.venues.position));
  const byId = new Map(
    VENUE_CATALOG.map((entry) => [entry.manifest.id, entry.manifest]),
  );
  return {
    items: rows.flatMap((row) => {
      const manifest = byId.get(row.id);
      if (!manifest) return [];
      return [
        {
          id: row.id,
          stage: row.stage,
          summary: row.summary,
          displayAllowed: row.displayAllowed,
          display: manifest.display,
          capabilities: manifest.capabilities,
          settlement: manifest.capabilities.settlement,
        },
      ];
    }),
  };
}
