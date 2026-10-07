/**
 * Default mapping from each venue's own categories and tags onto Hunch's
 * eight. Seeded into category_map at boot; admins edit rows, not code. A
 * market whose hints match nothing stays hidden in the beta.
 */
export const HUNCH_CATEGORIES = [
  "Economics",
  "Politics",
  "Tech",
  "Science",
  "Climate",
  "Sports",
  "Crypto",
  "Culture",
] as const;
export type HunchCategory = (typeof HUNCH_CATEGORIES)[number];

/** Venue category or tag (lower case) → Hunch category, per venue. */
export const DEFAULT_CATEGORY_MAP: Record<
  string,
  Record<string, HunchCategory>
> = {
  kalshi: {
    economics: "Economics",
    financials: "Economics",
    companies: "Tech",
    politics: "Politics",
    elections: "Politics",
    world: "Politics",
    "climate and weather": "Climate",
    "science and technology": "Science",
    health: "Science",
    transportation: "Tech",
    crypto: "Crypto",
    sports: "Sports",
    entertainment: "Culture",
    culture: "Culture",
    social: "Culture",
    mentions: "Culture",
  },
  // Jupiter Predict's categories, plus the Kalshi ones its Kalshi events carry.
  jupiter: {
    economics: "Economics",
    financials: "Economics",
    companies: "Tech",
    politics: "Politics",
    elections: "Politics",
    election: "Politics",
    world: "Politics",
    geopolitics: "Politics",
    tech: "Tech",
    "science and technology": "Science",
    science: "Science",
    health: "Science",
    "climate and weather": "Climate",
    climate: "Climate",
    weather: "Climate",
    crypto: "Crypto",
    sports: "Sports",
    esports: "Sports",
    culture: "Culture",
    entertainment: "Culture",
    mentions: "Culture",
  },
  polymarket: {
    economics: "Economics",
    economy: "Economics",
    finance: "Economics",
    business: "Economics",
    politics: "Politics",
    elections: "Politics",
    geopolitics: "Politics",
    world: "Politics",
    tech: "Tech",
    ai: "Tech",
    science: "Science",
    climate: "Climate",
    weather: "Climate",
    sports: "Sports",
    crypto: "Crypto",
    culture: "Culture",
    "pop-culture": "Culture",
    entertainment: "Culture",
    mentions: "Culture",
    celebrities: "Culture",
    awards: "Culture",
    movies: "Culture",
    music: "Culture",
    youtube: "Culture",
    "big-tech": "Tech",
    "fed-rates": "Economics",
    "fed-chair": "Economics",
    election: "Politics",
    "united-nations": "Politics",
    israel: "Politics",
    trump: "Politics",
    nfl: "Sports",
    football: "Sports",
    nba: "Sports",
    basketball: "Sports",
    mlb: "Sports",
    baseball: "Sports",
    nhl: "Sports",
    hockey: "Sports",
    soccer: "Sports",
    tennis: "Sports",
    golf: "Sports",
    ufc: "Sports",
    f1: "Sports",
    cricket: "Sports",
    esports: "Sports",
  },
  fixture: { fixture: "Economics" },
};

/** The first hint that maps wins; null when none does. */
export function categoryFor(
  map: ReadonlyMap<string, string>,
  venueId: string,
  hints: readonly string[],
): string | null {
  for (const hint of hints) {
    const hit = map.get(`${venueId}\u0000${hint.toLowerCase()}`);
    if (hit) return hit;
  }
  return null;
}
