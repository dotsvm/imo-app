/**
 * The venue registry: every venue the product lists, in order, with Hunch's
 * rollout plan for it. Manifests are static facts about a venue; rollout is
 * ours. In production the stage comes from the `venues` table; these are the
 * defaults. Adding a venue means one manifest import and one entry here.
 *
 * Browser-safe: it imports manifests only, never data sources.
 */
import type { VenueManifest } from "./sdk/manifest";
import { kalshi } from "./kalshi/manifest";
import { jupiter } from "./jupiter/manifest";
import { polymarket } from "./polymarket/manifest";

export type RolloutStage =
  "planned" | "coming-soon" | "data-only" | "paper" | "live";

export interface VenueEntry {
  manifest: VenueManifest;
  rollout: { stage: RolloutStage; summary: string };
}

/** The first entry is the venue Hunch supports first. */
export const VENUE_CATALOG: readonly VenueEntry[] = [
  {
    manifest: kalshi,
    rollout: {
      stage: "coming-soon",
      summary: "First supported venue · real trading after launch",
    },
  },
  {
    manifest: polymarket,
    rollout: {
      stage: "planned",
      summary: "Planned · prices shown for discovery only",
    },
  },
  {
    manifest: jupiter,
    rollout: {
      stage: "paper",
      summary: "Solana prediction markets · paper trading on live prices",
    },
  },
];
