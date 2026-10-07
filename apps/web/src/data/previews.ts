/**
 * Demo previews of exceptional states. The "error" preview simulates one venue
 * failing while the rest keep answering — whichever venue is listed last, so
 * the copy and the filtering follow the catalog.
 */
import { venueIds, venueList, venueName, type VenueId } from "./venues";

export const outageVenue: VenueId = venueIds.at(-1)!;
const answering = venueIds.filter((id) => id !== outageVenue);

/** In the error preview, only the venues still answering show markets. */
export const answersInPreview = (preview: string | null, venueId: VenueId) =>
  preview !== "error" || venueId !== outageVenue;

/** "Polymarket prices failed to load. Kalshi markets are shown." */
export const outageDetail = (what: "prices" | "markets" | "results") =>
  `${venueName(outageVenue)} ${what} failed to load. ${venueList("and", answering)} ${
    what === "results" ? "results" : "markets"
  } are shown.`;
