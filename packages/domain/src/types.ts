/** All currency values are integer USD cents. Prices are cents per whole share. */
import type { FeeModel } from "@imo/core/fees";
import type { VenueId } from "@imo/core/market";
export type Cents = number;
export type Outcome = "Yes" | "No";
export type Side = "Buy" | "Sell";
export type Scenario =
  "filled" | "pending" | "partial" | "failed" | "price-change";
/** The eight categories the onboarding export enumerates. */
export type Category =
  | "Economics"
  | "Politics"
  | "Tech"
  | "Science"
  | "Climate"
  | "Sports"
  | "Crypto"
  | "Culture";
export type Confidence = "Low" | "Medium" | "High";
export interface Market {
  id: string;
  /** A registry id: names, marks and fee labels come from the venue catalog. */
  venueId: VenueId;
  venueContractId: string;
  /** The venue's trading fee for this market, as data. */
  venueFee: FeeModel;
  title: string;
  shortTitle: string;
  category: Category;
  asset: string;
  yesPrice: Cents;
  /** Picked by an editor for Discover, with its line ("FOMC week"). */
  featured?: boolean;
  featuredLabel?: string | null;
  /** Top of the live book, when the server has one (null: that side is empty). */
  yesBid?: Cents | null;
  yesAsk?: Cents | null;
  change: number;
  volumeCents: Cents;
  liquidityCents: Cents;
  openInterestCents: Cents;
  closesAt: string;
  /** "closed" is 04.4: trading halted, the last price is not a result yet. */
  status: "open" | "closed" | "resolved";
  resolution: { rule: string; source: string; outcome?: Outcome };
  description: string;
  series: number[];
  traders: number;
  /** Hunch traders holding each side, for the "who's on each side" split. */
  holders: { yes: number; no: number };
}
export interface TraderRecord {
  /** Called the outcome correctly but still lost money on the trade. */
  rightNotProfitable: number;
  /** Sold before settlement for a profit while the call itself was wrong. */
  profitableNotRight: number;
  winTrades: number;
  lossTrades: number;
  avgHoldDays: number;
  feesCents: Cents;
  maxDrawdownCents: Cents;
  biggestLossCents: Cents;
  /** Where the biggest loss came from, e.g. "CPI May · No". */
  biggestLossOn: string;
  /** When the max drawdown happened, e.g. "Sep 8–12". */
  drawdownWindow: string;
  /** The all-time P&L, split into what's booked and what's still open. */
  realizedCents: Cents;
  unrealizedCents: Cents;
  /** Predictions published, over the trader's whole record. */
  predictions: number;
}
export interface Trader {
  id: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  /** Their photo (uploaded; Google's on older accounts) or chosen illustration; without either, initials. */
  avatarUrl?: string;
  /** A stand-in while their profile loads: name and handle, no numbers yet.
      Screens draw placeholders for it, never zeros. */
  pending?: true;
  bio: string;
  interests: Category[];
  focus: string;
  joined: string;
  venueId: VenueId;
  followers: number;
  following: number;
  rooms: number;
  /** Open positions are hidden on the profile when a trader opts out. */
  privatePositions: boolean;
  /** Rooms they belong to that you can see. */
  roomIds?: string[];
  /** Cumulative 30-day P&L as plotted, where a design gives it. */
  curve30?: Cents[];
  /** Cumulative P&L by day for each period, as the server last drew it. */
  curves?: Partial<Record<"7D" | "30D" | "90D" | "All", Cents[]>>;
  /** Place on the 30-day P&L board; null when they aren't on it. */
  rank30?: number | null;
  record: TraderRecord;
  stats: Record<
    "7D" | "30D" | "90D" | "All",
    {
      returnPct: number;
      correct: number;
      resolved: number;
      trades: number;
      pnlCents: Cents;
      startingCapitalCents: Cents;
    }
  >;
  /** Resolved record per category, for "on Economics markets" style cuts. */
  categories: Partial<Record<Category, { correct: number; resolved: number }>>;
  history: {
    marketId: string;
    outcome: Outcome;
    shares: number;
    entryPrice: Cents;
    exitPrice?: Cents;
    feeCents: Cents;
    /** A market that closed before the demo's snapshot, so it isn't listed:
        its question, when it resolved, and how. */
    archived?: { title: string; closedAt: string; result: Outcome };
  }[];
}
export interface Comment {
  id: string;
  authorId: string;
  text: string;
  at: string;
  /** Present on a reply to another reply; one level of indentation. */
  parentId?: string;
  likes?: number;
  /** What the commenter holds in the post's market (null: nothing, or private). */
  stake?: { outcome: Outcome; shares: number } | null;
}
/** A chart or figure attached to a prediction as supporting evidence. */
export interface PostImage {
  src: string;
  /** Required: the feed renders these as evidence, so they must be described. */
  alt: string;
  caption: string;
  /** Intrinsic size, so the feed can reserve space and avoid layout shift. */
  width: number;
  height: number;
}
export interface Post {
  id: string;
  authorId: string;
  marketId: string;
  outcome: Outcome;
  entryPrice: Cents;
  text: string;
  /** Optional follow-up paragraph: what would change the author's mind. */
  invalidation?: string;
  confidence: Confidence;
  disclosePosition: boolean;
  /** "public" or the id of the room the prediction was posted to. */
  audience: string;
  at: string;
  likes: number;
  reposts: number;
  views: number;
  backed: number;
  faded: number;
  evidenceShares: number;
  /** Evidence figures, rendered above the market card. */
  images: PostImage[];
  /** Loaded replies: all of them on the post's page, the top two in a feed. */
  comments: Comment[];
  /** Every reply, loaded or not. */
  commentCount?: number;
}
/** 09.1: a room talks in channels, one per catalyst. */
export interface Channel {
  id: string;
  topic: string;
  /** The market the channel is about: members' holdings in it show on
      every message there. */
  marketId?: string;
}
export interface RoomMessage {
  id: string;
  authorId: string;
  text: string;
  at: string;
  channel: string;
  /** A market linked from the composer, shown as a card. */
  marketId?: string;
  /** A reply in the thread under this message. */
  parentId?: string;
  /** "join": a system line — the author (and `with`) joined the channel. */
  kind?: "join";
  with?: string[];
  /** In a disclosure room, the author's position in the market discussed, as
      the server reports it (null: none, or kept private); unset until then. */
  holding?: { outcome: Outcome; shares: number } | null;
}
export type RoomRole = "Owner" | "Moderator" | "Member";
export type RoomNotify = "All messages" | "Mentions" | "Nothing";
export interface Room {
  id: string;
  name: string;
  description: string;
  symbol: string;
  owner: string;
  privacy: "Public" | "Invite only";
  online: number;
  /** Total community size. `members` only lists the traders we can address. */
  memberCount: number;
  postsToday: number;
  members: string[];
  /** Members seen in the room in the last few minutes (full rooms only). */
  onlineMembers?: string[];
  /** Members who moderate; the owner is `owner`. */
  moderators: string[];
  /** Invite-only rooms: traders waiting for approval. */
  requests: string[];
  /** 08.3: members' holdings show on messages about linked markets. */
  disclosure: boolean;
  rules: string;
  /** Your own notification choice for this room. */
  notify: RoomNotify;
  watchlist: string[];
  channels: Channel[];
  messages: RoomMessage[];
}
export interface Fill {
  id: string;
  at: string;
  side: Side;
  shares: number;
  priceCents: Cents;
  feeCents: Cents;
}
export interface Position {
  id: string;
  marketId: string;
  outcome: Outcome;
  shares: number;
  costCents: Cents;
  feeCents: Cents;
  fills: Fill[];
  /** What it would sell for now, as the server values it. */
  valueCents?: Cents;
}
export interface ClosedPosition extends Position {
  proceedsCents: Cents;
  exitFeeCents: Cents;
  closedAt: string;
}
export interface Quote {
  marketId: string;
  side: Side;
  outcome: Outcome;
  shares: number;
  priceCents: Cents;
  notionalCents: Cents;
  /** The venue's own trading fee, from the market's fee model. */
  venueFeeCents: Cents;
  /** Hunch's 0.5% app fee, always a separate line. */
  appFeeCents: Cents;
  feeCents: Cents;
  totalCents: Cents;
  payoutCents: Cents;
}
export interface Order {
  id: string;
  quote: Quote;
  status: "pending" | "filled" | "partial" | "failed" | "cancelled";
  at: string;
  filledShares: number;
  /** Still on the book (limits); a market order's unfilled rest is dropped. */
  resting?: boolean;
  /** What the fills actually cost (buys) or paid (sells), fees included. */
  filledTotalCents?: Cents;
  /** The fills' average price per share, before fees; null until one fills. */
  averagePriceCents?: number | null;
  /** Why it stopped short, in words. */
  reason?: string | null;
  /** Placed from a prediction's Back / Fade drawer: that prediction. */
  postId?: string;
  /** A limit order's price. */
  limitCents?: number | null;
}
export interface Activity {
  id: string;
  title: string;
  detail: string;
  amountCents: Cents;
  at: string;
  kind: "buy" | "sell" | "claim" | "order";
}
export type NotificationKind =
  "Order" | "Resolution" | "Reply" | "Follow" | "Room" | "Price";
export type NotificationIcon =
  | "filled"
  | "partial"
  | "failed"
  | "resolved"
  | "reply"
  | "follow"
  | "room"
  | "price";
export interface Notification {
  id: string;
  kind: NotificationKind;
  icon: NotificationIcon;
  title: string;
  body: string;
  at: string;
  href: string;
  cta?: { label: string; href: string; primary?: boolean };
}
export interface Watchlist {
  id: string;
  name: string;
  marketIds: string[];
  updatedAt: string;
}
export interface PriceAlert {
  id: string;
  marketId: string;
  outcome: Outcome;
  thresholdCents: Cents;
  direction: "above" | "below";
}
export interface NotificationPreference {
  id: string;
  label: string;
  description: string;
  app: boolean;
  email: boolean;
  /** Safety notifications cannot be switched off in the app. */
  locked?: boolean;
}
export interface Settings {
  /** Categories chosen during onboarding; empty until someone picks them. */
  interests: Category[];
  onboarded: boolean;
  displayName: string;
  handle: string;
  bio: string;
  email: string;
  region: string;
  theme: "Midnight" | "Dim" | "System";
  /** Show prices as 62¢ rather than 62%. */
  priceInCents: boolean;
  showPositionsOnPosts: boolean;
  appearOnLeaderboard: boolean;
  privateOpenPositions: boolean;
  notifications: NotificationPreference[];
  alerts: PriceAlert[];
}
export interface DemoState {
  version: 1;
  cashCents: Cents;
  /** Cash held for resting orders, as the server counts it. */
  reservedCents?: Cents;
  /** When the leaderboard's numbers were last computed. */
  leaderboardAt?: string | null;
  /** The paper account's season: what it started with, which season it
      is, and when a new one may start (null: any time). */
  season?: { startingBalanceCents: Cents; number: number; nextResetAt: string | null };
  positions: Position[];
  closed: ClosedPosition[];
  orders: Order[];
  activity: Activity[];
  /** The default "Saved markets" list, kept flat for bookmark toggles. */
  watchlist: string[];
  /** Additional named lists shown beside the default one. */
  watchlists: Watchlist[];
  following: string[];
  /** Traders whose new predictions you're notified about (13.1's bell). */
  notifyTraders: string[];
  liked: string[];
  bookmarked: string[];
  posts: Post[];
  rooms: Room[];
  /** When you last read each room channel, keyed `room/channel`. */
  channelReads: Record<string, string>;
  notifications: Notification[];
  readNotifications: string[];
  settings: Settings;
}

export interface BookLevel {
  priceCents: Cents;
  shares: number;
  depthPercent: number;
}
export interface RecentTrade {
  id: string;
  side: Side;
  outcome: Outcome;
  priceCents: Cents;
  shares: number;
  minutesAgo: number;
  /** When it traded, as the venue reports it. */
  at?: string;
}
