import { PREDICTIONS_CHANNEL } from "../rooms";
import type {
  DemoState,
  Post,
  PostImage,
  Room,
  Notification,
  Settings,
  Watchlist,
  Fill,
  Market,
  Confidence,
} from "../types";
import { venueFeeFor, appFeeFor } from "../money";
import { markets, traders } from "./hunch-data";
export { markets, traders };

const m = (id: string) => markets.find((x) => x.id === id)!;
const at = (iso: string) => new Date(iso).toISOString();

type PostSeed = {
  id: string;
  who: string;
  market: string;
  side: "Yes" | "No";
  text: string;
  invalidation?: string;
  confidence: Confidence;
  minutesAgo: number;
  likes: number;
  reposts: number;
  views: number;
  backed: number;
  faded: number;
  images?: PostImage[];
};

/** Figures live in /public/media so the demo needs no network. */
const figure = (file: string, alt: string, caption: string): PostImage => ({
  src: `/media/${file}.svg`,
  alt,
  caption,
  width: 640,
  height: 360,
});
/** Reasoning copied from the design exports wherever they print it. */
const postSeeds: PostSeed[] = [
  {
    id: "post0",
    who: "luis",
    market: "fed-dec",
    side: "No",
    text: "I think the Fed keeps rates unchanged in December. Core services is still running hot and three voters used the word “patient” this month. The market is pricing the chair, not the committee.",
    invalidation:
      "What would change my mind: an October core print of 0.2 or lower, or a dovish dissent at the November meeting. I’ll post if I exit.",
    confidence: "Medium",
    minutesAgo: 6,
    images: [
      figure(
        "fomc-dots",
        "Dot plot of FOMC participants’ year-end rate targets, with the 2026 cluster at 4.00 percent and a smaller group at 4.25 percent.",
        "Sep dots: nine participants still at 4.00 or above for year-end.",
      ),
    ],
    likes: 88,
    reposts: 11,
    views: 3100,
    backed: 38,
    faded: 12,
  },
  {
    id: "post1",
    who: "mira",
    market: "fed-dec",
    side: "Yes",
    text: "Minutes are out and two voters moved dovish. Futures still lag the chair’s tone — I’m adding at 62. “Patient” was about the pace, not December.",
    invalidation:
      "Out if October core prints 0.4. I’ll size down rather than argue with the data.",
    confidence: "High",
    minutesAgo: 24,
    likes: 212,
    reposts: 34,
    views: 8800,
    backed: 212,
    faded: 41,
  },
  {
    id: "post2",
    who: "ren",
    market: "cpi-oct",
    side: "Yes",
    text: "October CPI market is sleeping at 34¢. Has anyone actually looked at used cars this month? The shelter component is doing all the work in the consensus forecast.",
    confidence: "Medium",
    minutesAgo: 52,
    images: [
      figure(
        "cpi-components",
        "Bar chart of month-over-month contributions to core CPI: shelter plus 0.21 points, used cars plus 0.09, medical plus 0.05, airfares minus 0.04, apparel minus 0.02.",
        "Shelter is two thirds of the print. Used cars are the swing factor nobody is modelling.",
      ),
    ],
    likes: 141,
    reposts: 19,
    views: 5200,
    backed: 141,
    faded: 27,
  },
  {
    id: "post6",
    who: "hazel",
    market: "btc",
    side: "Yes",
    text: "Posting this one against myself. I am 2,000 Yes at 31¢ and the market is 20¢, so I am down about $220. Flows are the only argument I have left and they are still net positive 14 of the last 20 sessions.",
    invalidation:
      "If two consecutive weeks print net outflows I close it and take the loss rather than average down.",
    confidence: "Low",
    minutesAgo: 78,
    images: [
      figure(
        "etf-flows",
        "Bar chart of daily net flows into US spot Bitcoin ETFs over twenty sessions: fourteen inflow days and five outflow days, with the largest inflow in the most recent week.",
        "Fourteen net inflow days out of twenty. The demand is not the part that broke.",
      ),
    ],
    likes: 46,
    reposts: 4,
    views: 2100,
    backed: 31,
    faded: 22,
  },
  {
    id: "post3",
    who: "ann",
    market: "fed-dec",
    side: "No",
    text: "Faded the cut at 64 last week and I’m down $9 on it so far. Still think it’s rich. Posting the loss because the record should show both sides.",
    confidence: "Low",
    minutesAgo: 95,
    likes: 9,
    reposts: 1,
    views: 820,
    backed: 9,
    faded: 4,
  },
  {
    id: "post4",
    who: "dayo",
    market: "film",
    side: "No",
    text: "Paper Moons at 18¢ is still too expensive for a film with no precursor wins. The guild awards are the tell, not the festival buzz.",
    confidence: "High",
    minutesAgo: 140,
    images: [
      figure(
        "precursors",
        "Grid of four Best Picture nominees against four precursor awards. The Long Quiet won PGA, DGA and Critics; Harbour Lights won SAG; Paper Moons and Nine Winters won none.",
        "Every recent winner took at least one guild. Paper Moons has taken none.",
      ),
    ],
    likes: 67,
    reposts: 8,
    views: 2400,
    backed: 67,
    faded: 15,
  },
  {
    id: "post5",
    who: "ren",
    market: "hurricane",
    side: "No",
    text: "We’re past the climatological peak and the shear forecast is unfriendly. Base rates do most of the work in this one — I’m short the landfall.",
    confidence: "Medium",
    minutesAgo: 210,
    likes: 54,
    reposts: 6,
    views: 1900,
    backed: 54,
    faded: 11,
  },
];

export const posts: Post[] = postSeeds.map((p) => {
  const market = m(p.market);
  const held = traders
    .find((t) => t.id === p.who)!
    .history.find(
      (h) =>
        h.marketId === p.market &&
        h.outcome === p.side &&
        h.exitPrice === undefined,
    );
  return {
    id: p.id,
    authorId: p.who,
    marketId: p.market,
    outcome: p.side,
    entryPrice: held?.entryPrice ?? Math.max(5, market.yesPrice - 5),
    text: p.text,
    ...(p.invalidation ? { invalidation: p.invalidation } : {}),
    confidence: p.confidence,
    disclosePosition: true,
    audience: "public",
    at: at(
      new Date(
        Date.UTC(2026, 8, 25, 14, 26) - p.minutesAgo * 60000,
      ).toISOString(),
    ),
    likes: p.likes,
    reposts: p.reposts,
    views: p.views,
    backed: p.backed,
    faded: p.faded,
    evidenceShares: held?.shares ?? 0,
    images: p.images ?? [],
    comments: [],
  };
});
/** The thread the post-detail export spells out, attached to Luis's post. */
posts[0].comments = [
  {
    id: "c0",
    authorId: "mira",
    text: "“Patient” was about the pace, not December. The minutes read dovish to me — two voters moved.",
    at: at("2026-09-25T14:22:00Z"),
    likes: 31,
  },
  {
    id: "c1",
    authorId: "luis",
    parentId: "c0",
    text: "Fair. If October core prints 0.2 or lower I’m out and I’ll post the exit.",
    at: at("2026-09-25T14:24:00Z"),
    likes: 12,
  },
  {
    id: "c2",
    authorId: "ren",
    text: "What’s your read on the SEP dots? That seems like the bigger tell than the statement.",
    at: at("2026-09-25T14:14:00Z"),
    likes: 8,
  },
  {
    id: "c3",
    authorId: "ann",
    text: "Faded the cut at 64 last week. Down $9 on it so far, still think it’s rich.",
    at: at("2026-09-25T14:06:00Z"),
    likes: 5,
  },
];
posts[1].comments = [
  {
    id: "c4",
    authorId: "luis",
    text: "Counterpoint: “patient” showed up three times. I’m holding No.",
    at: at("2026-09-25T14:05:00Z"),
    likes: 17,
  },
];

const predictions = {
  id: PREDICTIONS_CHANNEL,
  topic: "Predictions posted about the room’s markets",
};
const general = (topic: string) => ({ id: "general", topic });

export const rooms: Room[] = [
  {
    id: "macro-desk",
    name: "Macro Desk",
    description: "Rates, inflation, jobs. Post a position or it didn’t happen.",
    symbol: "MD",
    owner: "mira",
    privacy: "Public",
    online: 86,
    memberCount: 1284,
    postsToday: 42,
    members: ["mira", "luis", "ren", "ann", "you"],
    moderators: ["luis"],
    requests: [],
    disclosure: true,
    rules:
      "Post a position or it didn’t happen. Link the market you’re talking about so your side shows. No sizing advice and no copy-trading calls.",
    notify: "Mentions",
    watchlist: ["fed-dec", "cpi-oct", "jobs-sep", "stable", "mayor"],
    channels: [
      general("Anything macro. Sources over vibes."),
      {
        id: "fomc-december",
        topic: "Dec 16 decision · post a position or it didn’t happen",
        marketId: "fed-dec",
      },
      {
        id: "cpi-watch",
        topic: "Oct CPI on Nov 13 · core, shelter, used cars",
        marketId: "cpi-oct",
      },
      {
        id: "jobs-report",
        topic: "Payrolls, JOLTS and claims",
        marketId: "jobs-sep",
      },
      predictions,
    ],
    messages: [
      {
        id: "mg1",
        authorId: "mira",
        channel: "general",
        text: "Welcome in. One channel per catalyst; #predictions collects anything with a position attached.",
        at: at("2026-09-23T13:00:00Z"),
      },
      {
        id: "mj1",
        kind: "join",
        authorId: "ann",
        with: ["ren"],
        channel: "general",
        text: "",
        at: at("2026-09-24T09:12:00Z"),
      },
      {
        id: "mg2",
        authorId: "luis",
        channel: "general",
        text: "Reminder: link the market when you talk about it — the card shows everyone’s side.",
        at: at("2026-09-24T15:20:00Z"),
      },
      {
        id: "rm1",
        authorId: "mira",
        channel: "fomc-december",
        text: "Minutes are out. Two voters moved dovish — adding to Dec Yes.",
        marketId: "fed-dec",
        at: at("2026-09-25T14:02:00Z"),
      },
      {
        id: "rm2",
        authorId: "luis",
        channel: "fomc-december",
        text: "Counterpoint: “patient” showed up three times. I’m holding No.",
        at: at("2026-09-25T14:05:00Z"),
      },
      {
        id: "rt1",
        authorId: "mira",
        channel: "fomc-december",
        parentId: "rm2",
        text: "@Luis Prado “patient” is about the pace after December, not December itself.",
        at: at("2026-09-25T14:07:00Z"),
      },
      {
        id: "rt2",
        authorId: "ann",
        channel: "fomc-december",
        parentId: "rm2",
        text: "Agree on the wording. The dots will matter more than the adjective.",
        at: at("2026-09-25T14:10:00Z"),
      },
      {
        id: "rt3",
        authorId: "luis",
        channel: "fomc-december",
        parentId: "rm2",
        text: "Fair. I’ll size down if October core prints under 0.3.",
        marketId: "cpi-oct",
        at: at("2026-09-25T14:13:00Z"),
      },
      {
        id: "rm3",
        authorId: "ren",
        channel: "fomc-december",
        text: "October CPI market is sleeping at 34¢ — anyone looked at used cars?",
        marketId: "cpi-oct",
        at: at("2026-09-25T14:09:00Z"),
      },
      {
        id: "rm4",
        authorId: "ann",
        channel: "fomc-december",
        text: "Down $9 fading the cut. Staying in, sizing is small.",
        at: at("2026-09-25T14:12:00Z"),
      },
      {
        id: "rm5",
        authorId: "you",
        channel: "fomc-december",
        text: "Bought 180 Yes at 54 over the week. Out if core prints 0.4.",
        at: at("2026-09-25T14:15:00Z"),
      },
      {
        id: "rm6",
        authorId: "mira",
        channel: "fomc-december",
        text: "@Jordan Reyes 54 was a good entry. Holding through the minutes?",
        at: at("2026-09-25T14:18:00Z"),
      },
      {
        id: "cw1",
        authorId: "ann",
        channel: "cpi-watch",
        text: "Consensus is 3.1. A 3.0 print resolves No — the market is paying for the rounding.",
        at: at("2026-09-24T18:40:00Z"),
      },
      {
        id: "cw2",
        authorId: "ren",
        channel: "cpi-watch",
        text: "Used cars turned down again. Shelter is the only thing holding core up.",
        marketId: "cpi-oct",
        at: at("2026-09-25T14:18:00Z"),
      },
      {
        id: "cw3",
        authorId: "mira",
        channel: "cpi-watch",
        text: "Cleveland Fed nowcast is 3.04 this morning. That’s a coin flip, not 34¢.",
        at: at("2026-09-25T14:21:00Z"),
      },
      {
        id: "cw4",
        authorId: "luis",
        channel: "cpi-watch",
        text: "Airfares will be the swing line. Nobody models them well.",
        at: at("2026-09-25T14:24:00Z"),
      },
      {
        id: "jr1",
        authorId: "luis",
        channel: "jobs-report",
        text: "Street is at 155K for September. Revisions matter more than the headline this time.",
        marketId: "jobs-sep",
        at: at("2026-09-24T12:10:00Z"),
      },
    ],
  },
  {
    id: "rates-only",
    name: "Rates Only",
    description: "One market at a time. No sports, no crypto, no exceptions.",
    symbol: "RO",
    owner: "ann",
    privacy: "Public",
    online: 31,
    memberCount: 612,
    postsToday: 9,
    members: ["ann", "mira"],
    moderators: [],
    requests: [],
    disclosure: true,
    rules: "Rates markets only. One thread per meeting.",
    notify: "Mentions",
    watchlist: ["fed-dec", "cpi-oct"],
    channels: [
      general("Front-end rates, one market at a time."),
      {
        id: "fomc-december",
        topic: "The December meeting",
        marketId: "fed-dec",
      },
      predictions,
    ],
    messages: [
      {
        id: "ro1",
        authorId: "ann",
        channel: "general",
        text: "Keeping this room narrow on purpose. Front-end only.",
        at: at("2026-09-24T16:10:00Z"),
      },
    ],
  },
  {
    id: "storm-track",
    name: "Storm Track",
    description:
      "Weather markets, base rates and the occasional cone of uncertainty.",
    symbol: "ST",
    owner: "ren",
    privacy: "Public",
    online: 18,
    memberCount: 389,
    postsToday: 17,
    members: ["ren", "dayo", "you"],
    moderators: [],
    requests: [],
    disclosure: true,
    rules: "Cite the model run. Base rates before narratives.",
    notify: "Mentions",
    watchlist: ["hurricane", "starship"],
    channels: [
      general("Weather, launches and base rates."),
      {
        id: "landfall",
        topic: "Cat 4 landfall before the season ends",
        marketId: "hurricane",
      },
      predictions,
    ],
    messages: [
      {
        id: "st1",
        authorId: "ren",
        channel: "landfall",
        text: "Shear forecast is unfriendly through the weekend. Landfall odds keep drifting.",
        marketId: "hurricane",
        at: at("2026-09-24T11:40:00Z"),
      },
    ],
  },
  {
    id: "court-side",
    name: "Court Side",
    description: "Postseason markets and the numbers behind the narratives.",
    symbol: "CS",
    owner: "dayo",
    privacy: "Public",
    online: 44,
    memberCount: 2041,
    postsToday: 118,
    members: ["dayo", "sam"],
    moderators: [],
    requests: [],
    disclosure: true,
    rules: "Numbers over narratives. No tipping.",
    notify: "Mentions",
    watchlist: ["yankees"],
    channels: [
      general("Postseason, priced."),
      { id: "alds", topic: "The Yankees’ series", marketId: "yankees" },
      predictions,
    ],
    messages: [
      {
        id: "cs1",
        authorId: "dayo",
        channel: "alds",
        text: "Series priced like a coin flip when the rotation says otherwise.",
        at: at("2026-09-18T20:05:00Z"),
      },
    ],
  },
  {
    id: "frontier",
    name: "Frontier",
    description: "Model releases, launch windows and resolution wording.",
    symbol: "FR",
    owner: "hazel",
    privacy: "Public",
    online: 23,
    memberCount: 918,
    postsToday: 36,
    members: ["hazel", "ren", "mira"],
    moderators: [],
    requests: [],
    disclosure: true,
    rules: "Read the resolution wording before you post.",
    notify: "Mentions",
    watchlist: ["model", "starship", "gpai"],
    channels: [
      general("Frontier tech, carefully resolved."),
      { id: "models", topic: "Model release windows", marketId: "model" },
      { id: "launches", topic: "Starship and friends", marketId: "starship" },
      predictions,
    ],
    messages: [
      {
        id: "fr1",
        authorId: "hazel",
        channel: "models",
        text: "Half the disagreement on GPT-6 is about the name, not the model.",
        marketId: "model",
        at: at("2026-09-23T09:05:00Z"),
      },
    ],
  },
  {
    id: "box-office",
    name: "Box Office Club",
    description: "Awards season, precursors and the long tail of Best Picture.",
    symbol: "BO",
    owner: "sam",
    privacy: "Invite only",
    online: 9,
    memberCount: 204,
    postsToday: 3,
    members: ["sam", "dayo"],
    moderators: [],
    requests: [],
    disclosure: true,
    rules: "Precursors, not predictions of vibes.",
    notify: "Mentions",
    watchlist: ["film"],
    channels: [
      general("Awards season."),
      {
        id: "best-picture",
        topic: "The long tail of Best Picture",
        marketId: "film",
      },
      predictions,
    ],
    messages: [
      {
        id: "bo1",
        authorId: "sam",
        channel: "general",
        text: "Precursor season starts next month. Until then this is all vibes.",
        at: at("2026-09-20T17:30:00Z"),
      },
    ],
  },
];

/** Where you left off in each channel: #cpi-watch and #predictions have
    news waiting, as 09.1 draws them. */
export const channelReads: Record<string, string> = {
  "macro-desk/general": at("2026-09-25T09:00:00Z"),
  "macro-desk/fomc-december": at("2026-09-25T14:26:00Z"),
  "macro-desk/cpi-watch": at("2026-09-25T09:00:00Z"),
  "macro-desk/jobs-report": at("2026-09-25T09:00:00Z"),
  "macro-desk/predictions": at("2026-09-24T12:00:00Z"),
  "storm-track/general": at("2026-09-25T09:00:00Z"),
  "storm-track/landfall": at("2026-09-25T09:00:00Z"),
  "storm-track/predictions": at("2026-09-25T09:00:00Z"),
};

const fill = (
  id: string,
  iso: string,
  market: Market,
  shares: number,
  priceCents: number,
): Fill => ({
  id,
  at: at(iso),
  side: "Buy",
  shares,
  priceCents,
  feeCents:
    venueFeeFor(market, shares, priceCents) + appFeeFor(shares * priceCents),
});

const notifications: Notification[] = [
  {
    id: "n1",
    kind: "Order",
    icon: "filled",
    title: "Order filled",
    body: "153 Yes · Fed cuts in December at 63¢. Total $99.37 including fees.",
    at: at("2026-09-25T14:32:00Z"),
    href: "/portfolio",
  },
  {
    id: "n2",
    kind: "Reply",
    icon: "reply",
    title: "Mira Kaplan replied to your prediction",
    body: "“Patient” was about the pace, not December. The minutes read dovish to me — two voters moved.",
    at: at("2026-09-25T14:22:00Z"),
    href: "/post/post0",
  },
  {
    id: "n3",
    kind: "Resolution",
    icon: "resolved",
    title: "Sept payrolls > 150K resolved Yes",
    body: "200 Yes × $1.00 payout. Cost basis $124.00 → profit +$76.00 once claimed.",
    at: at("2026-10-02T12:30:00Z"),
    href: "/portfolio?tab=Claimable",
    cta: {
      label: "Claim $200.00",
      href: "/portfolio?tab=Claimable",
      primary: true,
    },
  },
  {
    id: "n4",
    kind: "Follow",
    icon: "follow",
    title: "Ren Tanaka followed you",
    body: "Onchain flows and release calendars. Asks about resolution wording first.",
    at: at("2026-09-25T08:02:00Z"),
    href: "/trader/ren",
  },
  {
    id: "n5",
    kind: "Room",
    icon: "room",
    title: "New market in Macro Desk",
    body: "Luis Prado added Oct CPI above 3.0% to the shared watchlist.",
    at: at("2026-09-24T17:20:00Z"),
    href: "/rooms/macro-desk",
  },
  {
    id: "n6",
    kind: "Price",
    icon: "price",
    title: "Fed cuts in December crossed 60¢",
    body: "Yes is trading at 62¢, up 4 points over 24 hours.",
    at: at("2026-09-24T14:05:00Z"),
    href: "/market/fed-dec",
  },
  {
    id: "n7",
    kind: "Order",
    icon: "partial",
    title: "Partially filled",
    body: "120 of 500 Yes · BTC above $150K at 20¢. $76.00 still reserved.",
    at: at("2026-09-24T14:02:00Z"),
    href: "/portfolio?tab=Pending%20orders",
  },
  {
    id: "n8",
    kind: "Order",
    icon: "failed",
    title: "Order failed",
    body: "Buy 300 No · Paper Moons. Not enough liquidity at market. No funds were used.",
    at: at("2026-09-25T11:15:00Z"),
    href: "/market/film",
    cta: { label: "Retry as limit", href: "/market/film?trade=1" },
  },
];

const watchlists: Watchlist[] = [
  {
    id: "rates",
    name: "Rates & inflation",
    marketIds: ["fed-dec", "cpi-oct", "jobs-sep", "mayor", "stable"],
    updatedAt: at("2026-09-25T09:30:00Z"),
  },
  {
    id: "weather",
    name: "Weather",
    marketIds: ["hurricane"],
    updatedAt: at("2026-09-23T12:00:00Z"),
  },
  {
    id: "long-shots",
    name: "Long shots",
    marketIds: ["btc", "film", "starship"],
    updatedAt: at("2026-09-22T14:00:00Z"),
  },
];

export function defaultSettings(): Settings {
  return {
    interests: ["Economics", "Politics"],
    onboarded: false,
    displayName: "Jordan Reyes",
    handle: "jordan",
    bio: "Macro and sports. Learning in public — every trade posted.",
    email: "jordan.reyes@example.com",
    region: "United States · New York",
    theme: "Midnight",
    priceInCents: true,
    showPositionsOnPosts: true,
    appearOnLeaderboard: true,
    privateOpenPositions: false,
    notifications: [
      {
        id: "order-filled",
        label: "Order filled / partial",
        description: "Every fill, including partial fills",
        app: true,
        email: true,
      },
      {
        id: "order-failed",
        label: "Order failed",
        description: "Always on for safety",
        app: true,
        email: true,
        locked: true,
      },
      {
        id: "resolved",
        label: "Market resolved",
        description: "Includes claimable payouts",
        app: true,
        email: true,
      },
      {
        id: "closing",
        label: "Market closing soon",
        description: "24h before close, markets you hold",
        app: true,
        email: true,
      },
      {
        id: "replies",
        label: "Replies & mentions",
        description: "On your predictions and in rooms",
        app: true,
        email: false,
      },
      {
        id: "followers",
        label: "New followers",
        description: "Someone starts following you",
        app: true,
        email: false,
      },
      {
        id: "digest",
        label: "Traders you follow post",
        description: "Daily digest by email",
        app: true,
        email: false,
      },
      {
        id: "rooms",
        label: "Room activity",
        description: "Only rooms set to “all”",
        app: true,
        email: false,
      },
    ],
    alerts: [
      {
        id: "alert-fed",
        marketId: "fed-dec",
        outcome: "Yes",
        thresholdCents: 70,
        direction: "above",
      },
    ],
  };
}

export function initialState(): DemoState {
  const fed = m("fed-dec");
  const jobs = m("jobs-sep");
  const btc = m("btc");
  const model = m("model");
  const mayor = m("mayor");
  const stable = m("stable");
  return structuredClone({
    version: 1,
    // $9,079.85 cash; $166.00 of it is reserved against resting orders.
    cashCents: 907985,
    positions: [
      {
        id: "pos-fed",
        marketId: "fed-dec",
        outcome: "Yes",
        shares: 180,
        costCents: 9720,
        feeCents: 361,
        fills: [
          fill("fill-fed-1", "2026-09-18T14:14:00Z", fed, 100, 52),
          fill("fill-fed-2", "2026-09-22T19:40:00Z", fed, 80, 57),
        ],
      },
      {
        id: "pos-btc",
        marketId: "btc",
        outcome: "Yes",
        shares: 100,
        costCents: 2000,
        feeCents: 10,
        fills: [fill("fill-btc-1", "2026-09-24T18:02:00Z", btc, 100, 20)],
      },
      {
        id: "pos-model",
        marketId: "model",
        outcome: "No",
        shares: 200,
        costCents: 12600,
        feeCents: 63,
        fills: [fill("fill-model-1", "2026-09-20T15:00:00Z", model, 200, 63)],
      },
      {
        id: "pos-mayor",
        marketId: "mayor",
        outcome: "No",
        shares: 200,
        costCents: 13600,
        feeCents: 373,
        fills: [fill("fill-mayor-1", "2026-09-21T17:25:00Z", mayor, 200, 68)],
      },
      {
        id: "pos-stable",
        marketId: "stable",
        outcome: "Yes",
        shares: 730,
        costCents: 35040,
        feeCents: 175,
        fills: [fill("fill-stable-1", "2026-09-17T12:05:00Z", stable, 730, 48)],
      },
      {
        id: "pos-claim",
        marketId: "jobs-sep",
        outcome: "Yes",
        shares: 200,
        costCents: 12400,
        feeCents: 392,
        fills: [fill("fill-jobs-1", "2026-09-15T13:10:00Z", jobs, 200, 62)],
      },
    ],
    closed: [
      {
        id: "closed-yankees",
        marketId: "yankees",
        outcome: "Yes",
        shares: 100,
        costCents: 7100,
        feeCents: 220,
        proceedsCents: 3000,
        exitFeeCents: 125,
        closedAt: at("2026-09-19T02:40:00Z"),
        fills: [
          fill("fill-yank-1", "2026-09-12T18:00:00Z", m("yankees"), 100, 71),
        ],
      },
      {
        id: "closed-cpi",
        marketId: "cpi-oct",
        outcome: "Yes",
        shares: 150,
        costCents: 6750,
        feeCents: 250,
        proceedsCents: 9000,
        exitFeeCents: 288,
        closedAt: at("2026-09-11T14:20:00Z"),
        fills: [
          fill("fill-cpi-1", "2026-09-04T15:30:00Z", m("cpi-oct"), 150, 45),
        ],
      },
    ],
    orders: [
      {
        // 11.1 shows all three resting states. This one filled 100 of 500 and
        // the remainder is still working; the 100 are already in pos-btc.
        id: "order-btc-partial",
        quote: {
          marketId: "btc",
          side: "Buy",
          outcome: "Yes",
          shares: 500,
          priceCents: 20,
          notionalCents: 10000,
          venueFeeCents: 0,
          appFeeCents: 50,
          feeCents: 50,
          totalCents: 10050,
          payoutCents: 50000,
        },
        status: "partial",
        at: at("2026-09-24T14:02:00Z"),
        filledShares: 100,
      },
      {
        id: "order-fed-limit",
        quote: {
          marketId: "fed-dec",
          side: "Buy",
          outcome: "Yes",
          shares: 378,
          priceCents: 42,
          notionalCents: 15876,
          venueFeeCents: 645,
          appFeeCents: 79,
          feeCents: 724,
          totalCents: 16600,
          payoutCents: 37800,
        },
        status: "pending",
        at: at("2026-09-25T09:40:00Z"),
        filledShares: 0,
      },
      {
        // Market order that found no liquidity: nothing filled, nothing held.
        id: "order-film-failed",
        quote: {
          marketId: "film",
          side: "Buy",
          outcome: "No",
          shares: 300,
          priceCents: 82,
          notionalCents: 24600,
          venueFeeCents: 0,
          appFeeCents: 123,
          feeCents: 123,
          totalCents: 24723,
          payoutCents: 30000,
        },
        status: "failed",
        at: at("2026-09-25T11:15:00Z"),
        filledShares: 0,
      },
    ],
    activity: [
      {
        id: "a1",
        title: "Resolved Yes · Sept payrolls > 150K",
        detail: "200 Yes · $200.00 claimable",
        amountCents: 0,
        at: at("2026-10-02T12:30:00Z"),
        kind: "claim",
      },
      {
        id: "a2",
        title: "Order failed · Paper Moons",
        detail: "No liquidity at market · no funds used",
        amountCents: 0,
        at: at("2026-09-25T11:15:00Z"),
        kind: "order",
      },
      {
        id: "a3",
        title: "Limit placed · Fed cuts in December",
        detail: "Buy 378 Yes at 42¢ · $166.00 reserved",
        amountCents: -16600,
        at: at("2026-09-25T09:40:00Z"),
        kind: "order",
      },
      {
        id: "a3b",
        title: "Partial fill · BTC above $150K",
        detail: "100 / 500 Yes at 20¢ · $0.10 app fee",
        amountCents: -2010,
        at: at("2026-09-24T18:02:00Z"),
        kind: "buy",
      },
      {
        id: "a4",
        title: "Bought No · Incumbent holds City Hall",
        detail: "300 shares at 68¢ · $11.31 in fees",
        amountCents: -21531,
        at: at("2026-09-21T17:25:00Z"),
        kind: "buy",
      },
      {
        id: "a5",
        title: "Bought Yes · Fed cuts in December",
        detail: "80 shares at 57¢ · $1.60 in fees",
        amountCents: -4720,
        at: at("2026-09-22T19:40:00Z"),
        kind: "buy",
      },
      {
        id: "a6",
        title: "Sold Yes · Yankees win the ALDS",
        detail: "100 shares at 30¢ · realized −$44.45",
        amountCents: 2875,
        at: at("2026-09-19T02:40:00Z"),
        kind: "sell",
      },
      {
        id: "a7",
        title: "Sold Yes · Oct CPI above 3.0%",
        detail: "150 shares at 60¢ · realized +$17.12",
        amountCents: 8712,
        at: at("2026-09-11T14:20:00Z"),
        kind: "sell",
      },
      {
        id: "a8",
        title: "Demo account funded",
        detail: "Simulated funds",
        amountCents: 1000000,
        at: at("2026-09-01T09:00:00Z"),
        kind: "claim",
      },
    ],
    watchlist: ["fed-dec", "cpi-oct", "btc"],
    watchlists,
    following: ["hazel", "dayo"],
    notifyTraders: [],
    liked: [],
    bookmarked: ["post2", "post4"],
    posts,
    rooms,
    channelReads,
    notifications,
    readNotifications: ["n6", "n7", "n8"],
    settings: defaultSettings(),
  } as DemoState);
}

/** Kalshi-style book: asks above, bids below, with the exports' own depths. */
export function mockOrderBook(market: Market) {
  const levels = [1, 2, 3, 4, 5];
  return {
    bids: levels.map((n) => ({
      priceCents: Math.max(1, market.yesPrice - n),
      shares: [1780, 3340, 2210, 1460, 980][n - 1],
      depthPercent: [35, 66, 43, 29, 19][n - 1],
    })),
    asks: levels.map((n) => ({
      priceCents: Math.min(99, market.yesPrice + n),
      shares: [1240, 1905, 2860, 1520, 1105][n - 1],
      depthPercent: [24, 37, 56, 30, 22][n - 1],
    })),
  };
}
/** The tape: each trade is the side its taker bought, at that side's
    price, a cent either side of the last trade. */
export function mockRecentTrades(market: Market) {
  return [153, 400, 1200, 240, 85, 500, 96].map((shares, n) => {
    const outcome = (n % 3 === 2 ? "No" : "Yes") as "Yes" | "No";
    const yes = Math.min(
      99,
      Math.max(1, market.yesPrice + [1, 0, -1, 1, 0, 1, -1][n]),
    );
    return {
      id: `${market.id}-trade-${n}`,
      side: "Buy" as const,
      outcome,
      priceCents: outcome === "Yes" ? yes : 100 - yes,
      shares,
      minutesAgo: n * 3 + 1,
    };
  });
}
