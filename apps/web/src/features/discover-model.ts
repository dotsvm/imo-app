/* Discover's view model: the filters it reads from the URL, how they narrow
   and order markets, and how search ranks markets, traders and rooms. */
import type { Category, Market, Room, Trader } from "@imo/domain/types";
import { venueIds, venueName, type VenueId } from "@/data/venues";
import { dataNow } from "@/data/clock";

export const CATEGORIES: (Category | "All")[] = [
  "All",
  "Economics",
  "Politics",
  "Tech",
  "Science",
  "Climate",
  "Sports",
  "Crypto",
  "Culture",
];
export const SORTS = ["Trending", "Volume", "Closing soon", "New"] as const;
export type Sort = (typeof SORTS)[number];
/** "All" and every listed venue, by registry id. */
export const VENUES: readonly ("All" | VenueId)[] = ["All", ...venueIds];
export type VenueFilter = "All" | VenueId;
export const STATUSES = [
  ["open", "Open"],
  ["soon", "Closing within 7 days"],
  ["closed", "Closed · awaiting result"],
  ["resolved", "Resolved"],
] as const;
export type Status = (typeof STATUSES)[number][0];
export const SEARCH_TABS = ["All", "Markets", "Traders", "Rooms"] as const;
/** Session key: where "Esc to close" and Cancel return to. */
export const SEARCH_RETURN = "hunch-search-return";
/** The search screen's own field, for ⌘K while the topbar is hidden. */
export const SEARCH_FIELD = "search-field";
export type SearchTab = (typeof SEARCH_TABS)[number];

/** 03.3 slices a category further by the words its questions use. */
export const SUBSETS: Partial<Record<Category, Record<string, string[]>>> = {
  Economics: {
    Rates: ["rate", "fed", "target"],
    Inflation: ["cpi", "inflation", "price"],
    Jobs: ["payroll", "unemployment", "jobs"],
    Growth: ["gdp", "s&p", "growth", "crude", "gold"],
  },
  Politics: {
    Local: ["mayor", "city hall", "council"],
    Congress: ["congress", "house", "senate", "shutdown", "spending"],
    Elections: ["election", "win", "incumbent"],
  },
};

const DAY = 86_400_000;
/** The demo's fixed "now". */
export const daysLeft = (iso: string) =>
  Math.max(0, Math.round((Date.parse(iso) - dataNow()) / DAY));
export const closesIn = (m: Market) =>
  m.status === "resolved"
    ? "Resolved"
    : m.status === "closed"
      ? "Closed"
      : `${daysLeft(m.closesAt)}d`;
export const closeDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
export const statusLine = (m: Market) =>
  m.status === "open"
    ? `Closes ${closeDate(m.closesAt)}`
    : m.status === "closed"
      ? "Closed · awaiting result"
      : `Resolved ${m.resolution.outcome ?? ""}`.trim();

export type Filters = {
  q: string | null;
  tab: SearchTab;
  category: Category | "All";
  subset: string;
  sort: Sort;
  venue: VenueFilter;
  status: Status;
  min: number | null;
  max: number | null;
  view: "grid" | "list";
};
const pick = <T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T => (options.includes(value as T) ? (value as T) : fallback);
const cents = (value: string | null) => {
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
};

export function readFilters(params: URLSearchParams): Filters {
  const category = pick(params.get("category"), CATEGORIES, "All");
  return {
    q: params.has("q") ? (params.get("q") ?? "") : null,
    tab: pick(params.get("tab"), SEARCH_TABS, "All"),
    category,
    subset: params.get("subset") ?? "All",
    // A category page leads with volume; Discover with what is moving.
    sort: pick(
      params.get("sort"),
      SORTS,
      category === "All" ? "Trending" : "Volume",
    ),
    venue: pick(params.get("venue"), VENUES, "All"),
    status: pick(
      params.get("status"),
      STATUSES.map(([v]) => v),
      "open",
    ),
    min: cents(params.get("min")),
    max: cents(params.get("max")),
    view: params.get("view") === "list" ? "list" : "grid",
  };
}

/** Status is always set, so the count starts at one — as 02.1 shows it. */
export const filterCount = (f: Filters) =>
  1 + (f.venue === "All" ? 0 : 1) + (f.min !== null || f.max !== null ? 1 : 0);

/** Discover's sorts as the API names them. */
export const SORT_PARAM: Record<Sort, "trending" | "volume" | "closing" | "new"> = {
  Trending: "trending",
  Volume: "volume",
  "Closing soon": "closing",
  New: "new",
};

/** The API query for a set of Discover filters. */
export const serverFilters = (
  f: Pick<Filters, "sort" | "venue" | "min" | "max"> & { status: Filters["status"] | "all" },
  category?: string,
) => ({
  ...(category && category !== "All" ? { category } : {}),
  sort: SORT_PARAM[f.sort],
  ...(f.venue !== "All" ? { venue: f.venue } : {}),
  status: f.status,
  ...(f.min !== null ? { min: f.min } : {}),
  ...(f.max !== null ? { max: f.max } : {}),
});

export function narrow(
  markets: Market[],
  f: Pick<Filters, "venue" | "status" | "min" | "max">,
) {
  return markets.filter(
    (m) =>
      (f.venue === "All" || m.venueId === f.venue) &&
      (f.status === "open"
        ? m.status === "open"
        : f.status === "soon"
          ? m.status === "open" && daysLeft(m.closesAt) <= 7
          : m.status === f.status) &&
      (f.min === null || m.yesPrice >= f.min) &&
      (f.max === null || m.yesPrice <= f.max),
  );
}

export function order(list: Market[], sort: Sort, all: Market[]) {
  return [...list].sort((a, b) =>
    sort === "Volume"
      ? b.volumeCents - a.volumeCents
      : sort === "Closing soon"
        ? Date.parse(a.closesAt) - Date.parse(b.closesAt)
        : sort === "New"
          ? Date.parse(b.closesAt) - Date.parse(a.closesAt)
          : // "Trending" is the curated order the markets ship in.
            all.indexOf(a) - all.indexOf(b),
  );
}

/* ------------------------------------------------------------- Search */
const terms = (q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}$&%.>-]/gu, ""))
    .filter(Boolean);

/** How well a field set matches every term; 0 when any term is missing. */
function score(fields: [string, number][], words: string[]) {
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const [text, weight] of fields) {
      const t = text.toLowerCase();
      if (!t.includes(word)) continue;
      const atWord = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}`,
        "u",
      ).test(t);
      best = Math.max(best, weight * (atWord ? 2 : 1));
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const marketFields = (m: Market): [string, number][] => [
  [m.shortTitle, 4],
  [m.title, 3],
  [`${m.asset} ${m.category}`, 2],
  [`${venueName(m.venueId)} ${m.venueContractId}`, 1],
];

export function search(
  q: string,
  markets: Market[],
  traders: Trader[],
  rooms: Room[],
) {
  const words = terms(q);
  if (!words.length)
    return { markets: [], traders: [], rooms: [], words, total: 0 };
  const rankedMarkets = markets
    .map((m) => ({ m, s: score(marketFields(m), words) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.m.volumeCents - a.m.volumeCents)
    .map((r) => r.m);
  const hits = new Set(rankedMarkets.map((m) => m.id));
  // A trader or room also matches when they trade or track a matching
  // market — that is what makes "fed" surface the macro desk.
  const rankedTraders = traders
    .map((t) => ({
      t,
      s:
        score(
          [
            [t.name, 4],
            [t.handle, 4],
            [t.focus, 2],
            [t.bio, 1],
          ],
          words,
        ) + (t.history.some((h) => hits.has(h.marketId)) ? 1 : 0),
    }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.t.followers - a.t.followers)
    .map((r) => r.t);
  const rankedRooms = rooms
    .map((r) => ({
      r,
      s:
        score(
          [
            [r.name, 4],
            [r.description, 1],
          ],
          words,
        ) + (r.watchlist.some((id) => hits.has(id)) ? 1 : 0),
    }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.r.memberCount - a.r.memberCount)
    .map((r) => r.r);
  return {
    markets: rankedMarkets,
    traders: rankedTraders,
    rooms: rankedRooms,
    words,
    total: rankedMarkets.length + rankedTraders.length + rankedRooms.length,
  };
}

/** When nothing matches every word, the nearest market and room by any. */
export function closest(
  q: string,
  markets: Market[],
  rooms: Room[],
): { market?: Market; room?: Room } {
  const words = terms(q).filter((w) => !/^\d+$/.test(w));
  const any = (fields: [string, number][]) =>
    words.reduce((n, w) => n + score(fields, [w]), 0);
  const market = markets
    .filter((m) => m.status === "open")
    .map((m) => ({ m, s: any(marketFields(m)) }))
    .sort((a, b) => b.s - a.s || b.m.volumeCents - a.m.volumeCents)[0]?.m;
  // Failing words, a room that watches that market, or its category, is
  // the next best place to look.
  const categoryOf = new Map(markets.map((m) => [m.id, m.category]));
  const affinity = (r: Room) =>
    !market
      ? 0
      : r.watchlist.includes(market.id)
        ? 1
        : r.watchlist.some((id) => categoryOf.get(id) === market.category)
          ? 0.5
          : 0;
  const room = rooms
    .map((r) => ({
      r,
      s:
        any([
          [r.name, 2],
          [r.description, 1],
        ]) + affinity(r),
    }))
    .sort((a, b) => b.s - a.s || b.r.memberCount - a.r.memberCount)[0]?.r;
  return { market, room };
}
