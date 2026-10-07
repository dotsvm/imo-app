/**
 * hunch-data.ts — a reconstruction of the `hunch-data.js` the design exports
 * load but that was not delivered with them. The original names, handles, market titles,
 * prices, records and copy are taken from design/*.dc.html. Additional
 * fictional community profiles expand the trader sidebar. Values the exports never state are filled in consistently
 * and are, like everything here, fictional.
 */
import type { FeeModel } from "@imo/core/fees";
import type { VenueId } from "@imo/core/market";
import type { Category, Market, Trader } from "../types";

/**
 * The demo's venue fees, as data: Kalshi's formula rounded to the cent, and no
 * venue fee on Polymarket — the fictional snapshot the design exports price.
 * Live data takes each market's fee from its venue instead.
 */
const DEMO_VENUE_FEES: Record<VenueId, FeeModel> = {
  kalshi: {
    kind: "quadratic",
    rate: "0.07",
    appliesTo: "taker",
    rounding: { mode: "half-up", decimals: 2 },
  },
  polymarket: { kind: "none" },
};

type MarketSeed = {
  id: string;
  title: string;
  short: string;
  category: Category;
  venue: VenueId;
  contract: string;
  yes: number;
  change: number;
  volume: number;
  openInterest: number;
  traders: number;
  closes: string;
  status: "open" | "closed" | "resolved";
  outcome?: "Yes" | "No";
  rule: string;
  source: string;
  description: string;
};

const marketSeeds: MarketSeed[] = [
  {
    id: "fed-dec",
    title: "Will the Fed cut rates at the December 2026 meeting?",
    short: "Fed cuts in December",
    category: "Economics",
    venue: "kalshi",
    contract: "FED-26DEC",
    yes: 62,
    change: 4,
    volume: 421000000,
    openInterest: 162000000,
    traders: 3120,
    closes: "2026-12-16T19:00:00Z",
    status: "open",
    rule: "Resolves Yes if the FOMC lowers the upper bound of the federal funds target range at the meeting concluding Dec 16, 2026. Resolves No otherwise, including if the meeting is postponed past Dec 31.",
    source: "Federal Reserve press release",
    description:
      "The committee has held for three meetings. Core services keeps the hawks in the room, while the labour data keeps giving the doves something to point at.",
  },
  {
    id: "cpi-oct",
    title: "Will October core CPI come in above 3.0% year over year?",
    short: "Oct CPI above 3.0%",
    category: "Economics",
    venue: "kalshi",
    contract: "CPI-26OCT",
    yes: 34,
    change: -2,
    volume: 187000000,
    openInterest: 74000000,
    traders: 1840,
    closes: "2026-11-13T13:30:00Z",
    status: "open",
    rule: "Resolves Yes if the first published October 2026 core CPI year-over-year change is strictly above 3.0%. Exactly 3.0% resolves No. Later revisions do not change the outcome.",
    source: "BLS Consumer Price Index release",
    description:
      "Used cars and shelter are pulling in opposite directions. The market has been asleep at this level for two weeks.",
  },
  {
    id: "jobs-sep",
    title: "Will September nonfarm payrolls exceed 150K?",
    short: "Sept payrolls > 150K",
    category: "Economics",
    venue: "kalshi",
    contract: "NFP-26SEP",
    yes: 100,
    change: 0,
    volume: 264000000,
    openInterest: 0,
    traders: 2410,
    closes: "2026-10-02T12:30:00Z",
    status: "resolved",
    outcome: "Yes",
    rule: "Resolved Yes. The BLS reported +184K nonfarm payrolls for September 2026. Each Yes share pays $1.00; each No share pays $0.00.",
    source: "Employment Situation, Oct 2, 2026",
    description:
      "Settled above the line on the first print. Revisions do not reopen the contract.",
  },
  {
    id: "btc",
    title: "Will Bitcoin trade above $150,000 during 2026?",
    short: "BTC above $150K",
    category: "Crypto",
    venue: "polymarket",
    contract: "PM-BTC-150K",
    yes: 20,
    change: 3,
    volume: 1240000000,
    openInterest: 310000000,
    traders: 9640,
    closes: "2026-12-31T23:59:00Z",
    status: "open",
    rule: "Resolves Yes if the BTC/USD reference price prints at or above $150,000 at any one-minute observation before Dec 31, 2026, 23:59 UTC.",
    source: "Polymarket BTC/USD reference index",
    description:
      "A long-dated tail. Cheap for a reason, and worth sizing like the tail it is.",
  },
  {
    id: "stable",
    title: "Will stablecoin supply exceed $350B this year?",
    short: "Stablecoin supply > $350B",
    category: "Crypto",
    venue: "polymarket",
    contract: "PM-STABLE-350",
    yes: 52,
    change: 1.5,
    volume: 78000000,
    openInterest: 24000000,
    traders: 1210,
    closes: "2026-12-31T23:59:00Z",
    status: "open",
    rule: "Resolves Yes if aggregate circulating USD-pegged stablecoin supply exceeds $350 billion at the Dec 31, 2026 UTC daily observation. Non-USD stablecoins are excluded.",
    source: "Aggregate stablecoin supply dataset",
    description:
      "An underrated liquidity signal. Issuance has been steady rather than dramatic.",
  },
  {
    id: "mayor",
    title: "Will the incumbent win the 2026 mayoral race?",
    short: "Incumbent holds City Hall",
    category: "Politics",
    venue: "kalshi",
    contract: "MAYOR-26",
    yes: 30,
    change: -5,
    volume: 930000000,
    openInterest: 210000000,
    traders: 7180,
    closes: "2026-11-04T04:00:00Z",
    status: "open",
    rule: "Resolves Yes if the incumbent is certified as the winner of the November 2026 mayoral election. A runoff resolves the contract on the runoff result.",
    source: "Certified election results",
    description:
      "Polling error is wider than the day-to-day price action suggests. Size accordingly.",
  },
  {
    id: "hurricane",
    title: "Will a Category 4 hurricane make US landfall in 2026?",
    short: "Cat 4 US landfall",
    category: "Climate",
    venue: "kalshi",
    contract: "HURR-26",
    yes: 22,
    change: -1,
    volume: 64000000,
    openInterest: 19000000,
    traders: 890,
    closes: "2026-11-30T23:59:00Z",
    status: "open",
    rule: "Resolves Yes if the National Hurricane Center records a Category 4 or stronger hurricane making landfall on the US mainland during the 2026 season.",
    source: "National Hurricane Center advisories",
    description:
      "Season is past its climatological peak, which is most of why this has drifted lower.",
  },
  {
    id: "yankees",
    title: "Will the Yankees win the ALDS?",
    short: "Yankees win the ALDS",
    category: "Sports",
    venue: "polymarket",
    contract: "PM-ALDS-NYY",
    yes: 0,
    change: 0,
    volume: 220000000,
    openInterest: 0,
    traders: 4020,
    closes: "2026-09-19T03:00:00Z",
    status: "resolved",
    outcome: "No",
    rule: "Resolved No. The series was decided in five games and the Yankees were eliminated. Each No share pays $1.00; each Yes share pays $0.00.",
    source: "Official MLB postseason result",
    description: "Settled. Recorded in closed positions with the loss intact.",
  },
  {
    id: "model",
    title: "Will GPT-6 be released before 2027?",
    short: "GPT-6 before 2027",
    category: "Tech",
    venue: "polymarket",
    contract: "PM-GPT6-2027",
    yes: 42,
    change: 6,
    volume: 120000000,
    openInterest: 38000000,
    traders: 2260,
    closes: "2026-12-31T23:59:00Z",
    status: "open",
    rule: "Resolves Yes if a model marketed as GPT-6 is generally available to the public before Jan 1, 2027. A limited research preview does not qualify.",
    source: "Public product announcement",
    description:
      "The naming convention is doing a lot of work in this contract. Read the resolution criteria twice.",
  },
  {
    id: "film",
    title: "Will Paper Moons win Best Picture?",
    short: "Paper Moons wins Best Picture",
    category: "Culture",
    venue: "polymarket",
    contract: "PM-BP-PAPERMOONS",
    yes: 18,
    change: -3,
    volume: 43000000,
    openInterest: 11000000,
    traders: 760,
    closes: "2027-03-15T02:00:00Z",
    status: "open",
    rule: "Resolves Yes if Paper Moons is announced as the Best Picture winner at the 2027 ceremony.",
    source: "Live ceremony announcement",
    description:
      "Thin book, wide spread. The precursor awards have not settled on a favourite.",
  },
  {
    id: "starship",
    title: "Will Starship complete an orbital refuel test in 2026?",
    short: "Starship refuel test",
    category: "Science",
    venue: "polymarket",
    contract: "PM-STARSHIP-REFUEL",
    yes: 45,
    change: 2,
    volume: 89000000,
    openInterest: 27000000,
    traders: 1630,
    closes: "2026-12-31T23:59:00Z",
    status: "open",
    rule: "Resolves Yes if a ship-to-ship propellant transfer in orbit is publicly confirmed before Jan 1, 2027.",
    source: "Operator confirmation or launch broadcast",
    description:
      "Schedule risk is the whole trade here. The engineering case is not really in dispute.",
  },
  {
    id: "gpai",
    title: "Will the EU publish the GPAI code of practice by Sep 1?",
    short: "EU GPAI code by Sep 1",
    category: "Tech",
    venue: "kalshi",
    contract: "EU-GPAI-SEP",
    yes: 71,
    change: 0,
    volume: 31000000,
    openInterest: 9000000,
    traders: 540,
    closes: "2026-09-01T12:00:00Z",
    status: "closed",
    rule: "Resolves Yes if the final General-Purpose AI code of practice is published in the Official Journal on or before Sep 1, 2026. Awaiting the source document.",
    source: "Official Journal of the European Union",
    description:
      "Trading is halted. The last price of 71¢ is a price, not a result — resolution is expected within 48 hours.",
  },
];

/** Additional fictional markets for exploring multiple pages in the demo. */
const extraMarketTopics: [string, string, string, Category, string][] = [
  [
    "eth-6k",
    "ETH above $6K",
    "Will Ethereum trade above $6,000 during 2026?",
    "Crypto",
    "ETH/USD reference index",
  ],
  [
    "sol-300",
    "SOL above $300",
    "Will Solana trade above $300 during 2026?",
    "Crypto",
    "SOL/USD reference index",
  ],
  [
    "btc-dominance",
    "BTC dominance > 60%",
    "Will Bitcoin market dominance exceed 60% on December 31, 2026?",
    "Crypto",
    "Aggregate crypto market capitalization",
  ],
  [
    "defi-tvl",
    "DeFi TVL above $200B",
    "Will total DeFi TVL exceed $200 billion on December 31, 2026?",
    "Crypto",
    "Aggregate DeFi TVL dataset",
  ],
  [
    "stable-400",
    "Stablecoins above $400B",
    "Will USD stablecoin supply exceed $400 billion on December 31, 2026?",
    "Crypto",
    "Aggregate stablecoin supply dataset",
  ],
  [
    "eth-etf",
    "ETH ETF inflows > $5B",
    "Will US spot Ethereum ETFs record over $5 billion in net inflows during 2026?",
    "Crypto",
    "ETF issuer flow reports",
  ],
  [
    "sol-etf",
    "US Solana ETF approval",
    "Will a US spot Solana ETF receive regulatory approval during 2026?",
    "Crypto",
    "SEC approval orders",
  ],
  [
    "crypto-cap",
    "Crypto market cap > $5T",
    "Will total crypto market capitalization exceed $5 trillion on December 31, 2026?",
    "Crypto",
    "Aggregate crypto market capitalization",
  ],
  [
    "fed-nov",
    "Fed cuts in November",
    "Will the Fed lower its target rate at its November 2026 meeting?",
    "Economics",
    "FOMC policy statement",
  ],
  [
    "inflation-dec",
    "December CPI below 3%",
    "Will December 2026 headline CPI be below 3% year over year on its first release?",
    "Economics",
    "BLS CPI release",
  ],
  [
    "jobs-oct",
    "October payrolls > 150K",
    "Will October 2026 nonfarm payroll growth exceed 150,000 on its first release?",
    "Economics",
    "BLS Employment Situation",
  ],
  [
    "gdp-q4",
    "Q4 GDP growth > 2%",
    "Will the advance estimate of US Q4 2026 annualized real GDP growth exceed 2%?",
    "Economics",
    "BEA advance GDP estimate",
  ],
  [
    "unemployment",
    "Unemployment below 4.5%",
    "Will the December 2026 US unemployment rate be below 4.5% on its first release?",
    "Economics",
    "BLS Employment Situation",
  ],
  [
    "oil-100",
    "Brent closes above $100",
    "Will Brent crude settle above $100 per barrel on the final trading day of 2026?",
    "Economics",
    "ICE Brent settlement",
  ],
  [
    "gold-4000",
    "Gold above $4,000",
    "Will the gold benchmark exceed $4,000 per ounce on the final trading day of 2026?",
    "Economics",
    "LBMA gold benchmark",
  ],
  [
    "spx-7000",
    "S&P 500 above 7,000",
    "Will the S&P 500 close above 7,000 on the final trading day of 2026?",
    "Economics",
    "S&P index closing value",
  ],
  [
    "turnout",
    "Midterm turnout > 50%",
    "Will certified US 2026 midterm voter turnout exceed 50% of eligible voters?",
    "Politics",
    "Certified election turnout totals",
  ],
  [
    "house-control",
    "Democrats take the House",
    "Will Democrats hold a majority of seats after the 2026 US House election is certified?",
    "Politics",
    "Certified US House results",
  ],
  [
    "senate-control",
    "Republicans hold Senate",
    "Will Republicans hold a majority of seats after the 2026 US Senate election is certified?",
    "Politics",
    "Certified US Senate results",
  ],
  [
    "shutdown",
    "US shutdown before 2027",
    "Will a US federal funding lapse cause a government shutdown before January 1, 2027?",
    "Politics",
    "OPM operating status notices",
  ],
  [
    "budget",
    "US budget deal in 2026",
    "Will a full-year US federal spending package be signed into law before January 1, 2027?",
    "Politics",
    "Enacted federal legislation",
  ],
  [
    "ai-device",
    "New AI wearable in 2026",
    "Will a major smartphone manufacturer ship a standalone AI wearable to US consumers during 2026?",
    "Tech",
    "Manufacturer shipping announcements",
  ],
  [
    "robotaxi",
    "Robotaxis in 10 US cities",
    "Will one operator offer paid driverless rides in at least 10 US cities by December 31, 2026?",
    "Tech",
    "Operator service-area announcements",
  ],
  [
    "ai-open",
    "Open model tops benchmark",
    "Will an open-weight model rank first on the public general-chat leaderboard on December 31, 2026?",
    "Tech",
    "Public model leaderboard snapshot",
  ],
  [
    "quantum",
    "Quantum system > 2K qubits",
    "Will a vendor publicly demonstrate a quantum processor with over 2,000 physical qubits during 2026?",
    "Tech",
    "Vendor technical publication",
  ],
  [
    "chips",
    "New 2nm consumer chip",
    "Will a consumer device using a 2nm-class processor ship during 2026?",
    "Tech",
    "Manufacturer specifications and shipping records",
  ],
  [
    "lunar",
    "Commercial lunar landing",
    "Will a commercial spacecraft complete a soft lunar landing during Q4 2026?",
    "Science",
    "Mission operator confirmation",
  ],
  [
    "launches",
    "150 orbital launches in Q4",
    "Will at least 150 orbital launch attempts occur worldwide during Q4 2026?",
    "Science",
    "Orbital launch records",
  ],
  [
    "fusion",
    "New fusion energy record",
    "Will a peer-reviewed experiment report a new fusion energy-output record during Q4 2026?",
    "Science",
    "Peer-reviewed research publication",
  ],
  [
    "mars",
    "New Mars mission launches",
    "Will a spacecraft bound for Mars launch during Q4 2026?",
    "Science",
    "Mission operator launch confirmation",
  ],
  [
    "hottest-year",
    "2026 warmest year on record",
    "Will 2026 rank as the warmest year in the global annual temperature dataset?",
    "Climate",
    "Copernicus annual climate report",
  ],
  [
    "atlantic-storms",
    "20 named Atlantic storms",
    "Will the 2026 Atlantic hurricane season record at least 20 named storms?",
    "Climate",
    "NHC season summary",
  ],
  [
    "arctic-ice",
    "Arctic ice below 4M km²",
    "Will the final 2026 annual minimum Arctic sea ice extent be below 4 million square kilometers?",
    "Climate",
    "NSIDC annual minimum report",
  ],
  [
    "renewables",
    "US renewables exceed 30%",
    "Will renewable sources supply over 30% of US electricity generation during 2026?",
    "Climate",
    "EIA annual electricity data",
  ],
  [
    "world-series",
    "World Series goes 7 games",
    "Will the 2026 World Series require seven games?",
    "Sports",
    "Official MLB series results",
  ],
  [
    "nba-overtime",
    "NBA opener goes to overtime",
    "Will the first game of the 2026–27 NBA regular season go to overtime?",
    "Sports",
    "Official NBA game result",
  ],
  [
    "nfl-undefeated",
    "NFL team starts 10–0",
    "Will any NFL team win its first ten regular-season games in 2026?",
    "Sports",
    "Official NFL standings",
  ],
  [
    "f1-title",
    "F1 title decided at finale",
    "Will the 2026 Formula 1 drivers title remain undecided before the final race?",
    "Sports",
    "Official FIA championship standings",
  ],
  [
    "box-office",
    "Q4 film grosses $1B",
    "Will a film first released in Q4 2026 gross over $1 billion worldwide by December 31, 2026?",
    "Culture",
    "Worldwide theatrical box-office totals",
  ],
  [
    "streaming-record",
    "New streaming debut record",
    "Will a scripted series set a new platform-reported first-week viewing record during Q4 2026?",
    "Culture",
    "Platform weekly viewing report",
  ],
  [
    "album-sales",
    "Album debut exceeds 1M",
    "Will an album debut with more than one million US equivalent album units in a week during Q4 2026?",
    "Culture",
    "Published weekly US album chart",
  ],
];
const extraMarketSeeds: MarketSeed[] = extraMarketTopics.map(
  ([id, short, title, category, source], index) => ({
    id,
    short,
    title,
    category,
    source,
    venue: index % 2 === 0 ? "kalshi" : "polymarket",
    contract: `DEMO-${id.toUpperCase()}-26`,
    yes: 18 + ((index * 13) % 65),
    change: ((index % 2 === 0 ? 1 : -1) * ((index % 9) + 1)) / 10,
    volume: 18000000 + index * 2370000,
    openInterest: 4200000 + index * 610000,
    traders: 280 + index * 47,
    closes: "2026-12-31T23:59:00Z",
    status: "open",
    rule: `Resolves Yes if the condition and time period in “${title}” are met according to ${source}. Otherwise resolves No. This is a fictional demo contract.`,
    description: `An illustrative ${category.toLowerCase()} market. Review the stated condition, time period, and resolution source before making a prediction.`,
  }),
);

/** A deterministic 7-day Yes-price walk that ends on the market's price. */
function series(seed: string, end: number, change: number) {
  const base = [...seed].reduce((n, c) => (n * 33 + c.charCodeAt(0)) % 101, 7);
  return Array.from({ length: 36 }, (_, i) => {
    const drift = (change * (i - 35)) / 35;
    const wobble = Math.sin((i + base) * 0.7) * 2 + Math.sin(i * 0.31) * 1.2;
    return Math.max(2, Math.min(98, Math.round(end + drift + wobble)));
  }).map((v, i, a) => (i === a.length - 1 ? end : v));
}

/** A slice of the venue's traders also hold the contract on Hunch. Their
    Yes/No split leans with the price but never matches it exactly — a price
    is a probability, not a headcount. */
const holdersFor = (id: string, traders: number, yes: number) => {
  const seed = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 89, 11);
  const total = Math.max(12, Math.round(traders / 14) + seed);
  const yesShare = Math.min(88, Math.max(12, yes + (seed % 9) - 4));
  const yesCount = Math.round((total * yesShare) / 100);
  return { yes: yesCount, no: total - yesCount };
};

export const markets: Market[] = [...marketSeeds, ...extraMarketSeeds].map(
  (m) => ({
    id: m.id,
    venueId: m.venue,
    venueContractId: m.contract,
    venueFee: DEMO_VENUE_FEES[m.venue],
    title: m.title,
    shortTitle: m.short,
    category: m.category,
    asset: m.category,
    yesPrice: m.yes,
    change: m.change,
    volumeCents: m.volume,
    liquidityCents: Math.round(m.openInterest / 3),
    openInterestCents: m.openInterest,
    closesAt: m.closes,
    status: m.status,
    resolution: {
      rule: m.rule,
      source: m.source,
      ...(m.outcome ? { outcome: m.outcome } : {}),
    },
    description: m.description,
    series: series(m.id, m.yes, m.change),
    traders: m.traders,
    holders: holdersFor(m.id, m.traders, m.yes),
  }),
);

type TraderSeed = {
  id: string;
  name: string;
  handle: string;
  ini: string;
  focus: string;
  joined: string;
  venue: VenueId;
  interests: Category[];
  bio: string;
  /** 30-day accuracy and sample, exactly as the exports print them. */
  right: number;
  resolved: number;
  pnl30: number;
  roi30: number;
  fees: number;
  drawdown: number;
  biggestLoss: number;
  followers: number;
  following: number;
  rooms: number;
  private?: boolean;
  /** All-time P&L where the design prints it; otherwise scaled from 30D. */
  pnlAll?: number;
  biggestLossOn?: string;
  drawdownWindow?: string;
  curve30?: number[];
};

const traderSeeds: TraderSeed[] = [
  {
    id: "mira",
    name: "Mira Kaplan",
    handle: "mirak",
    ini: "MK",
    focus: "Macro & rates",
    joined: "Mar 2025",
    venue: "kalshi",
    interests: ["Economics", "Politics"],
    bio: "Ex-rates desk. I trade central-bank communication, not headlines. Sizing notes in every post.",
    right: 64,
    resolved: 212,
    pnl30: 1842055,
    roi30: 22.4,
    fees: 41280,
    drawdown: -214000,
    biggestLoss: -124000,
    followers: 12400,
    following: 318,
    rooms: 3,
    pnlAll: 4190210,
    biggestLossOn: "CPI May · No",
    drawdownWindow: "Sep 8–12",
    // 13.1's plotted climb, Aug 26 → Sep 25, in dollars.
    curve30: [
      0, 420, 380, 1100, 1650, 1400, 2300, 2900, 2600, 3900, 5200, 4100, 3060,
      3300, 4800, 6200, 7400, 7100, 8800, 10400, 11200, 12900, 12100, 13800,
      15200, 16100, 15700, 17300, 18420.55,
    ].map((v) => Math.round(v * 100)),
  },
  {
    id: "luis",
    name: "Luis Prado",
    handle: "lvprado",
    ini: "LP",
    focus: "Politics",
    joined: "Jan 2025",
    venue: "kalshi",
    interests: ["Politics", "Economics"],
    bio: "Counting votes and reading statements. I post the exit as loudly as the entry.",
    right: 55,
    resolved: 421,
    pnl30: 488030,
    roi30: 9.8,
    fees: 40255,
    drawdown: -261000,
    biggestLoss: -61200,
    followers: 8900,
    following: 244,
    rooms: 2,
    biggestLossOn: "Senate map · Yes",
    drawdownWindow: "Aug 30–Sep 4",
  },
  {
    id: "dayo",
    name: "Dayo Okonkwo",
    handle: "dayo",
    ini: "DO",
    focus: "Sports",
    joined: "Feb 2025",
    venue: "polymarket",
    interests: ["Sports", "Culture"],
    bio: "Numbers first, narrative second. Most of my edge is in the unglamorous markets.",
    right: 58,
    resolved: 168,
    pnl30: 1190210,
    roi30: 14.2,
    fees: 38810,
    drawdown: -172000,
    biggestLoss: -88000,
    followers: 6120,
    following: 190,
    rooms: 2,
    biggestLossOn: "NBA Finals · No",
    drawdownWindow: "Sep 1–5",
  },
  {
    id: "ren",
    name: "Ren Tanaka",
    handle: "rtanaka",
    ini: "RT",
    focus: "Climate",
    joined: "Jun 2025",
    venue: "kalshi",
    interests: ["Climate", "Science"],
    bio: "Meteorology background. Base rates beat vibes in almost every weather market.",
    right: 61,
    resolved: 96,
    pnl30: 611572,
    roi30: 11.5,
    fees: 15100,
    drawdown: -102000,
    biggestLoss: -47000,
    followers: 4380,
    following: 152,
    rooms: 1,
    biggestLossOn: "Cat 4 landfall · Yes",
    drawdownWindow: "Sep 14–18",
  },
  {
    id: "hazel",
    name: "Hazel Quint",
    handle: "hazelq",
    ini: "HQ",
    focus: "Tech & AI",
    joined: "Apr 2025",
    venue: "polymarket",
    interests: ["Tech", "Crypto"],
    bio: "Onchain flows and release calendars. I read the resolution wording before the thesis.",
    right: 57,
    resolved: 74,
    pnl30: 934000,
    roi30: 7.9,
    fees: 9640,
    drawdown: -88000,
    biggestLoss: -31000,
    followers: 2740,
    following: 121,
    rooms: 1,
    biggestLossOn: "GPT-6 date · No",
    drawdownWindow: "Sep 2–6",
  },
  {
    id: "ann",
    name: "Ann North",
    handle: "north",
    ini: "AN",
    focus: "Crypto",
    joined: "Sep 2025",
    venue: "kalshi",
    interests: ["Economics"],
    bio: "Currently wrong and sizing small. Both of those are on purpose.",
    right: 49,
    resolved: 131,
    pnl30: -231045,
    roi30: -4.1,
    fees: 4490,
    drawdown: -340000,
    biggestLoss: -96000,
    followers: 1630,
    following: 98,
    rooms: 1,
    biggestLossOn: "Aug jobs · No",
    drawdownWindow: "Sep 10–24",
  },
  {
    id: "sam",
    name: "Sam Pilling",
    handle: "sampling",
    ini: "SP",
    focus: "Culture",
    joined: "Aug 2026",
    venue: "polymarket",
    interests: ["Culture"],
    bio: "Five resolved markets and an opinion about all of them. Treat the record with care.",
    right: 80,
    resolved: 5,
    pnl30: 320000,
    roi30: 6.2,
    fees: 820,
    drawdown: -15000,
    biggestLoss: -9000,
    followers: 410,
    following: 63,
    rooms: 1,
    private: true,
    biggestLossOn: "Opening weekend · No",
    drawdownWindow: "Sep 20–22",
  },
  // Additional fictional community members populate the trader sidebar.
  {
    id: "priya",
    name: "Priya Shah",
    handle: "priyash",
    ini: "PS",
    focus: "Inflation & employment",
    joined: "May 2025",
    venue: "kalshi",
    interests: ["Economics"],
    bio: "Following wage growth, survey revisions, and the gap between the two.",
    right: 63,
    resolved: 184,
    pnl30: 762480,
    roi30: 16.8,
    fees: 22140,
    drawdown: -138000,
    biggestLoss: -54000,
    followers: 5210,
    following: 146,
    rooms: 2,
  },
  {
    id: "eli",
    name: "Eli Brooks",
    handle: "elibrooks",
    ini: "EB",
    focus: "AI & software",
    joined: "Jul 2025",
    venue: "polymarket",
    interests: ["Tech", "Science"],
    bio: "Release dates, benchmark results, and careful reading of the fine print.",
    right: 60,
    resolved: 142,
    pnl30: 624150,
    roi30: 13.1,
    fees: 18420,
    drawdown: -121000,
    biggestLoss: -48000,
    followers: 3890,
    following: 173,
    rooms: 2,
  },
  {
    id: "sofia",
    name: "Sofia Costa",
    handle: "sofiac",
    ini: "SC",
    focus: "Elections & polling",
    joined: "Apr 2025",
    venue: "kalshi",
    interests: ["Politics"],
    bio: "Local polls and turnout models. Every forecast starts with a base rate.",
    right: 62,
    resolved: 237,
    pnl30: 421875,
    roi30: 10.6,
    fees: 17280,
    drawdown: -96000,
    biggestLoss: -36000,
    followers: 4670,
    following: 208,
    rooms: 2,
  },
  {
    id: "noah",
    name: "Noah Kim",
    handle: "noahk",
    ini: "NK",
    focus: "Crypto liquidity",
    joined: "Aug 2025",
    venue: "polymarket",
    interests: ["Crypto", "Economics"],
    bio: "Watching liquidity, stablecoin issuance, and where the flows actually go.",
    right: 59,
    resolved: 118,
    pnl30: 268940,
    roi30: 8.7,
    fees: 12840,
    drawdown: -84000,
    biggestLoss: -29000,
    followers: 2860,
    following: 132,
    rooms: 1,
  },
  {
    id: "amara",
    name: "Amara Okafor",
    handle: "amarao",
    ini: "AO",
    focus: "Weather & energy",
    joined: "Jun 2025",
    venue: "kalshi",
    interests: ["Climate", "Science"],
    bio: "Weather models with uncertainty attached. Small positions through noisy forecasts.",
    right: 58,
    resolved: 89,
    pnl30: 174620,
    roi30: 7.2,
    fees: 8450,
    drawdown: -71000,
    biggestLoss: -24500,
    followers: 2140,
    following: 104,
    rooms: 1,
  },
  {
    id: "leo",
    name: "Leo Martin",
    handle: "leom",
    ini: "LM",
    focus: "Sports analytics",
    joined: "Oct 2025",
    venue: "polymarket",
    interests: ["Sports"],
    bio: "Injury reports, schedule effects, and prices that move before the news.",
    right: 56,
    resolved: 203,
    pnl30: 123850,
    roi30: 5.9,
    fees: 11430,
    drawdown: -93000,
    biggestLoss: -42000,
    followers: 3280,
    following: 187,
    rooms: 2,
  },
  {
    id: "ines",
    name: "Ines Duarte",
    handle: "inesd",
    ini: "ID",
    focus: "Film & culture",
    joined: "Jan 2026",
    venue: "polymarket",
    interests: ["Culture", "Tech"],
    bio: "Tracking opening weekends and audience retention. Posting the misses too.",
    right: 57,
    resolved: 67,
    pnl30: 86420,
    roi30: 4.8,
    fees: 6270,
    drawdown: -46000,
    biggestLoss: -18000,
    followers: 1580,
    following: 92,
    rooms: 1,
  },
  {
    id: "owen",
    name: "Owen Clarke",
    handle: "owenc",
    ini: "OC",
    focus: "Rates & growth",
    joined: "Nov 2025",
    venue: "kalshi",
    interests: ["Economics", "Politics"],
    bio: "Reading the data releases twice and keeping the position sizes small.",
    right: 51,
    resolved: 106,
    pnl30: -62480,
    roi30: -2.3,
    fees: 7310,
    drawdown: -115000,
    biggestLoss: -38000,
    followers: 1270,
    following: 119,
    rooms: 1,
  },
  {
    id: "you",
    name: "Jordan Reyes",
    handle: "jordan",
    ini: "JR",
    focus: "Macro, sports",
    joined: "Sep 2026",
    venue: "kalshi",
    interests: ["Economics", "Sports"],
    bio: "Macro and sports. Learning in public — every trade posted.",
    right: 67,
    resolved: 3,
    pnl30: 4705,
    roi30: 0.5,
    fees: 985,
    drawdown: -4100,
    biggestLoss: -4100,
    followers: 24,
    following: 41,
    rooms: 1,
  },
];

/** Stable fictional profiles give the demo several real pages of results. */
const communityNames = [
  "Zara Ahmed",
  "Mateo Silva",
  "Chloe Bennett",
  "Arjun Mehta",
  "Nina Petrov",
  "Oscar Lind",
  "Aisha Hassan",
  "Felix Weber",
  "Lena Fischer",
  "Hugo Rossi",
  "Mei Chen",
  "Ibrahim Yusuf",
  "Eva Novak",
  "Lucas Reed",
  "Freya Olsen",
  "Kai Wilson",
  "Dalia Mansour",
  "Theo Laurent",
  "Maya Singh",
  "Jasper Wood",
  "Sana Malik",
  "Rafael Lima",
  "Alice Morgan",
  "Kenji Sato",
  "Clara Jensen",
  "Tariq Ali",
  "Elena Popov",
  "Ben Walker",
  "Yara Haddad",
  "Finn Walsh",
  "Anika Rao",
  "Marco Leone",
  "Isla Campbell",
  "Dante Cruz",
  "Lila Park",
  "Victor Huang",
  "Nadia Rahman",
  "Max Turner",
  "Esme Dubois",
  "Rohan Patel",
  "Ada Svensson",
  "Tomas Vega",
  "Imani James",
  "Julian Fox",
  "Leila Farouk",
];
const communityCategories: Category[] = [
  "Economics",
  "Politics",
  "Crypto",
  "Tech",
  "Sports",
  "Climate",
  "Culture",
  "Science",
];
const communitySeeds: TraderSeed[] = communityNames.map((name, index) => {
  const category = communityCategories[index % communityCategories.length];
  const handle = name.toLowerCase().replaceAll(" ", "");
  return {
    id: handle,
    name,
    handle,
    ini: name
      .split(" ")
      .map((part) => part[0])
      .join(""),
    focus: category,
    joined: "Jan 2026",
    venue: index % 2 === 0 ? "kalshi" : "polymarket",
    interests: [category],
    bio: `Following ${category.toLowerCase()} markets. Sharing forecasts, position sizes, and what would change my mind.`,
    right: 48 + ((index * 7) % 19),
    resolved: 42 + ((index * 23) % 240),
    pnl30: 286500 - index * 8740,
    roi30: Math.round((12.8 - index * 0.39) * 10) / 10,
    fees: 2400 + index * 173,
    drawdown: -(34000 + index * 1420),
    biggestLoss: -(12000 + index * 630),
    followers: 420 + ((index * 317) % 4800),
    following: 38 + ((index * 13) % 210),
    rooms: 1 + (index % 3),
  };
});

const ALL_CATEGORIES: Category[] = [
  "Economics",
  "Politics",
  "Tech",
  "Science",
  "Climate",
  "Sports",
  "Crypto",
  "Culture",
];
/** A trader resolves far more in the categories they follow than outside
    them. Deterministic, and the hit rate matches their overall record. */
const categoryRecord = (
  interests: Category[],
  resolved30d: number,
  right: number,
) => {
  const out: Trader["categories"] = {};
  ALL_CATEGORIES.forEach((category, i) => {
    const weight = interests.includes(category) ? 9 : 2;
    const jitter = ((i * 31 + resolved30d) % 5) + 1;
    const n = Math.round((resolved30d * weight) / 260) + jitter;
    if (n < 3) return;
    out[category] = { resolved: n, correct: Math.round((n * right) / 100) };
  });
  return out;
};

/** Sample size scales with the period so the minimum-sample filter is real. */
const periodScale = {
  "7D": { sample: 0.06, pnl: 0.22, trades: 0.1 },
  "30D": { sample: 1, pnl: 1, trades: 1 },
  "90D": { sample: 2.6, pnl: 2.2, trades: 2.6 },
  All: { sample: 4.1, pnl: 3.4, trades: 4.2 },
} as const;

export const traders: Trader[] = [...traderSeeds, ...communitySeeds].map(
  (t) => {
    const stats = Object.fromEntries(
      (["7D", "30D", "90D", "All"] as const).map((period) => {
        const k = periodScale[period];
        const resolved = Math.max(1, Math.round(t.resolved * k.sample));
        const trades = Math.max(1, Math.round(t.resolved * 1.6 * k.trades));
        return [
          period,
          {
            returnPct: Math.round(t.roi30 * k.pnl * 10) / 10,
            correct: Math.round((resolved * t.right) / 100),
            resolved,
            trades,
            pnlCents: Math.round(t.pnl30 * k.pnl),
            startingCapitalCents: Math.round(
              Math.abs(t.pnl30 * k.pnl) /
                (Math.abs(t.roi30 * k.pnl) / 100 || 1),
            ),
          },
        ];
      }),
    ) as Trader["stats"];
    const all = stats.All;
    if (t.pnlAll !== undefined) all.pnlCents = t.pnlAll;
    // About a tenth of a record is still open.
    const unrealized = Math.round(all.pnlCents * 0.0905);
    const wins = Math.round((t.resolved * (t.right + 2.5)) / 100);
    return {
      id: t.id,
      name: t.name,
      handle: t.handle,
      initials: t.ini,
      color: "sage",
      bio: t.bio,
      interests: t.interests,
      focus: t.focus,
      joined: t.joined,
      venueId: t.venue,
      followers: t.followers,
      following: t.following,
      rooms: t.rooms,
      privatePositions: !!t.private,
      ...(t.curve30 && { curve30: t.curve30 }),
      stats,
      categories: categoryRecord(t.interests, stats["30D"].resolved, t.right),
      record: {
        rightNotProfitable: Math.round(t.resolved * 0.066),
        profitableNotRight: Math.round(t.resolved * 0.042),
        winTrades: wins,
        lossTrades: t.resolved - wins,
        avgHoldDays: Math.round((4.1 + t.resolved / 40) * 10) / 10,
        feesCents: t.fees,
        maxDrawdownCents: t.drawdown,
        biggestLossCents: t.biggestLoss,
        biggestLossOn: t.biggestLossOn ?? "single resolved position",
        drawdownWindow: t.drawdownWindow ?? "peak to trough",
        realizedCents: all.pnlCents - unrealized,
        unrealizedCents: unrealized,
        predictions: Math.round(t.resolved * 1.5),
      },
      history: [],
    };
  },
);

/** Open and resolved positions each trader discloses, by market. */
const holdings: [
  string,
  string,
  "Yes" | "No",
  number,
  number,
  number?,
  number?,
][] = [
  // 13.1: Mira's record, newest resolved first, with the design's P&L.
  ["mira", "jobs-sep", "Yes", 1000, 58, 100, 800],
  ["mira", "aug-cpi", "No", 500, 45, 0, 500],
  ["mira", "fed-sep", "Yes", 450, 59, 100, 450],
  ["mira", "jackson-hole", "Yes", 500, 51, 71, 500],
  ["mira", "gdp-q2", "Yes", 200, 55, 38, 600],
  ["mira", "claims-aug", "No", 310, 59, 100, 110],
  ["mira", "fed-dec", "Yes", 1200, 57],
  ["mira", "cpi-oct", "No", 800, 61],
  ["mira", "stable", "Yes", 500, 47],
  ["mira", "mayor", "No", 300, 66],
  ["mira", "btc", "No", 400, 77],
  ["mira", "gpai", "Yes", 250, 34],
  ["mira", "model", "No", 200, 52],
  ["mira", "hurricane", "No", 150, 70],
  ["mira", "film", "No", 100, 78],
  ["luis", "fed-dec", "No", 400, 41],
  ["luis", "mayor", "Yes", 650, 34],
  ["luis", "jobs-sep", "No", 220, 39, 0],
  ["dayo", "yankees", "No", 900, 62, 100],
  ["dayo", "film", "No", 500, 79],
  ["hazel", "btc", "Yes", 2000, 31],
  ["hazel", "model", "Yes", 700, 36],
  ["ren", "hurricane", "No", 600, 74],
  ["ren", "starship", "Yes", 350, 43],
  ["ann", "fed-dec", "No", 150, 64],
  ["ann", "jobs-sep", "No", 400, 44, 0],
  ["sam", "film", "Yes", 120, 21],
  ["you", "fed-dec", "Yes", 180, 54],
];
/** Markets that closed before the snapshot: not listed, but on records. */
const archived: Record<
  string,
  { title: string; closedAt: string; result: "Yes" | "No" }
> = {
  "aug-cpi": {
    title: "Will August CPI come in above 2.8% YoY?",
    closedAt: "2026-09-11T12:30:00Z",
    result: "Yes",
  },
  "fed-sep": {
    title: "Will the Fed hold rates in September?",
    closedAt: "2026-09-17T18:00:00Z",
    result: "Yes",
  },
  "jackson-hole": {
    title: "Will the chair say “cut” at Jackson Hole?",
    closedAt: "2026-08-23T14:00:00Z",
    result: "No",
  },
  "gdp-q2": {
    title: "Will Q2 GDP be revised above 2.0%?",
    closedAt: "2026-08-29T12:30:00Z",
    result: "Yes",
  },
  "claims-aug": {
    title: "Will jobless claims top 250K in August?",
    closedAt: "2026-08-21T12:30:00Z",
    result: "No",
  },
};
holdings.forEach(
  ([who, marketId, outcome, shares, entryPrice, exitPrice, fee]) => {
    const trader = traders.find((t) => t.id === who);
    const market = markets.find((m) => m.id === marketId);
    if (!trader || (!market && !archived[marketId])) return;
    trader.history.push({
      marketId,
      outcome,
      shares,
      entryPrice,
      ...(exitPrice === undefined ? {} : { exitPrice }),
      feeCents:
        fee ??
        Math.round((0.07 * shares * entryPrice * (100 - entryPrice)) / 100) +
          Math.round(shares * entryPrice * 0.005),
      ...(archived[marketId] && { archived: archived[marketId] }),
    });
  },
);
