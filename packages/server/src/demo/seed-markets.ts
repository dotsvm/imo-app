/**
 * Seed the design's markets through the normal ingestion path, keeping the
 * design ids as slugs (/market/fed-dec), plus their quotes and the Hunch
 * holder split the cards show.
 */
import { eq, inArray } from "drizzle-orm";
import type { Logger } from "@imo/core/ports/runtime";
import { markets as designMarkets } from "@imo/domain/demo/hunch-data";
import { HUNCH_CATEGORIES } from "../categories";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { upsertMarkets } from "../usecases/ingest";
import {
  DESIGN_SNAPSHOT,
  DESIGN_SOURCE,
  designQuote,
  designToCanonical,
} from "./design-source";

export async function seedDesignMarkets(db: Db, log: Logger) {
  // Design markets carry Hunch categories already: map each to itself.
  const categories = new Map<string, string>();
  for (const venueId of new Set(designMarkets.map((m) => m.venueId)))
    for (const category of HUNCH_CATEGORIES)
      categories.set(`${venueId}\u0000${category.toLowerCase()}`, category);

  const slugOf = new Map(
    designMarkets.map((m) => [`${m.venueId}:${m.venueContractId}`, m.id]),
  );
  const result = await upsertMarkets(db, designMarkets.map(designToCanonical), {
    source: DESIGN_SOURCE,
    log,
    categories,
    slug: (market) =>
      slugOf.get(`${market.ref.venueId}:${market.ref.externalId}`)!,
  });

  const rows = await db
    .select({ id: t.markets.id, slug: t.markets.slug })
    .from(t.markets)
    .where(
      inArray(
        t.markets.slug,
        designMarkets.map((m) => m.id),
      ),
    );
  const idOf = new Map(rows.map((r) => [r.slug, r.id]));
  const at = new Date(DESIGN_SNAPSHOT);
  // The design lists markets in a curated order: that is its trending rank.
  for (const [rank, m] of designMarkets.entries()) {
    const marketId = idOf.get(m.id);
    if (!marketId) continue;
    const quote = designQuote(m);
    await db
      .insert(t.marketQuotes)
      .values({ marketId, ...quote, source: DESIGN_SOURCE, updatedAt: at })
      .onConflictDoUpdate({
        target: t.marketQuotes.marketId,
        set: { ...quote, source: DESIGN_SOURCE, updatedAt: at },
      });
    const total = m.holders.yes + m.holders.no;
    await db
      .insert(t.marketHolders)
      .values({
        marketId,
        yes: m.holders.yes,
        no: m.holders.no,
        yesShare: total ? m.holders.yes / total : 0,
      })
      .onConflictDoUpdate({
        target: t.marketHolders.marketId,
        set: {
          yes: m.holders.yes,
          no: m.holders.no,
          yesShare: total ? m.holders.yes / total : 0,
        },
      });
    await db
      .update(t.markets)
      .set({ traders: m.traders })
      .where(eq(t.markets.id, marketId));
    await db
      .insert(t.marketTrending)
      .values({
        marketId,
        score: designMarkets.length - rank,
        rank: rank + 1,
        computedAt: at,
      })
      .onConflictDoUpdate({
        target: t.marketTrending.marketId,
        set: { rank: rank + 1, score: designMarkets.length - rank },
      });
  }
  // Discover's featured event, as the design shows it.
  await db.update(t.markets).set({ featured: true, featuredLabel: "FOMC week" }).where(eq(t.markets.slug, "fed-dec"));
  return { ...result, markets: idOf.size };
}
