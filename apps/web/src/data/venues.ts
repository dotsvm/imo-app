/**
 * How screens learn about venues: names, marks, fee labels and rollout, read
 * from the registry. Screens never name a venue themselves, so a new venue
 * appears everywhere once it's in the catalog.
 */
import type { FeeModel } from "@imo/core/fees";
import type { VenueId } from "@imo/core/market";
import { VENUE_CATALOG, type VenueEntry } from "@imo/venues/catalog";

export type { VenueId };

const byId = new Map(VENUE_CATALOG.map((entry) => [entry.manifest.id, entry]));

/** Every listed venue, in catalog order. */
export const venueIds: readonly VenueId[] = VENUE_CATALOG.map(
  (entry) => entry.manifest.id,
);

export function venueEntry(id: VenueId): VenueEntry {
  const entry = byId.get(id);
  if (!entry) throw new RangeError(`Unknown venue: ${id}`);
  return entry;
}

export const isVenueId = (value: string | null | undefined): value is VenueId =>
  !!value && byId.has(value);

export const venueDisplay = (id: VenueId) => venueEntry(id).manifest.display;
export const venueName = (id: VenueId) => venueDisplay(id).name;

/** "Kalshi and Polymarket" · "Kalshi or Polymarket" · "A, B and C". */
export function venueList(
  conjunction: "and" | "or",
  ids: readonly VenueId[] = venueIds,
): string {
  const names = ids.map(venueName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}

const ROLLOUT_TAGS: Record<
  VenueEntry["rollout"]["stage"],
  { label: string; tone: "accent" | "neutral" }
> = {
  planned: { label: "Planned", tone: "neutral" },
  "coming-soon": { label: "Coming soon", tone: "accent" },
  "data-only": { label: "Prices only", tone: "neutral" },
  paper: { label: "Paper trading", tone: "accent" },
  live: { label: "Live", tone: "accent" },
};

/** How a venue's rollout reads as a tag: "Coming soon", "Planned". */
export const rolloutTag = (id: VenueId) =>
  ROLLOUT_TAGS[venueEntry(id).rollout.stage];

/** The venue Hunch supports first. */
export const primaryVenue = (): VenueId => venueIds[0];

/** What a ticket says beside the venue fee. */
export const venueFeeNote = (id: VenueId, fee: FeeModel) =>
  fee.kind === "none"
    ? `${venueName(id)} charges none`
    : venueDisplay(id).feeLabel;
