/**
 * The whole design dataset into Postgres, domain by domain: markets (upserted
 * by natural keys, so re-running refreshes them), then people, records,
 * predictions, rooms and the demo viewer (written once).
 */
import type { Logger } from "@imo/core/ports/runtime";
import type { Db } from "../db/client";
import { seedDesignMarkets } from "./seed-markets";
import { seedDesignSocial } from "./seed-social";

export async function seedDesign(db: Db, log: Logger) {
  const markets = await seedDesignMarkets(db, log);
  const social = await seedDesignSocial(db, log);
  return { markets, social };
}
