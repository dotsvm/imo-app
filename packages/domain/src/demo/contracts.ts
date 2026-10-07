/**
 * What the screens ask of their data. Reads are synchronous over a snapshot
 * that fills from the API (undefined or empty while loading); changes that
 * the screen needs an answer from are promises, the rest are fire-and-forget
 * with the change shown at once.
 */
import type { AvatarPreset } from "@imo/core/avatars";
import type {
  DemoState,
  BookLevel,
  RecentTrade,
  Market,
  Order,
  Trader,
  Quote,
  Outcome,
  Post,
  Confidence,
  Settings,
  PriceAlert,
  Room,
  RoomRole,
  Side,
} from "../types";
export interface MarketService {
  list(): Market[];
  get(id: string): Market | undefined;
  orderBook(id: string): { bids: BookLevel[]; asks: BookLevel[] };
  /** The Yes price over a range, oldest first, from the venue's own
      history: undefined while loading, null when it can't be had. */
  history(id: string, range: HistoryRange): PricePoint[] | null | undefined;
  recentTrades(id: string): RecentTrade[];
  /** Whether the venue's live book or tape could be had: "loading" until
      it answers, "unavailable" when it couldn't be reached and there's
      nothing to show, "ready" once it has arrived (even if it's empty). */
  feed(kind: "book" | "trades", id: string): "loading" | "ready" | "unavailable";
  /** Markets like this one, as the server picks them (same category, by
      volume): undefined while loading. */
  related(id: string): Market[] | undefined;
  /** Who holds it on Hunch, biggest first: undefined while loading. */
  holders(id: string): { trader: Trader; outcome: Outcome; shares: number }[] | undefined;
  /** Markets matching filters, as the server orders them (up to 100):
      undefined while loading. */
  query(filters: MarketFilters): Market[] | undefined;
  /** Markets, traders and rooms matching words: undefined while loading,
      null when the search couldn't run. */
  search(q: string): { markets: Market[]; traders: Trader[]; rooms: Room[] } | null | undefined;
}
export type HistoryRange = "1D" | "1W" | "1M" | "All";
/** A moment in a market's history: epoch milliseconds, Yes price in cents. */
export interface PricePoint {
  at: number;
  yes: number;
}
export interface MarketFilters {
  category?: string;
  sort?: "trending" | "movers" | "volume" | "closing" | "new";
  venue?: string;
  status?: "open" | "soon" | "closed" | "resolved" | "all";
  min?: number;
  max?: number;
  q?: string;
}
/** A ticket as the person filled it in: dollars to buy, shares to sell. */
export interface TicketRequest {
  marketId: string;
  side: Side;
  outcome: Outcome;
  type: "Market" | "Limit";
  input: string;
  limitCents?: number;
}
export interface OrderService {
  /** The server's quote: undefined while it loads; throws its reason when
      the ticket can't be filled as asked. */
  preview(request: TicketRequest): Quote | undefined;
  /** The last quote for this ticket at any amount: shown while a new one loads. */
  latest(request: TicketRequest): Quote | undefined;
  /** Place an order at the reviewed price (a move past slippage rejects
      with `price_moved` and the new quote); `postId` when it backs or fades
      a prediction. */
  submit(
    request: TicketRequest,
    options: { clientOrderId: string; expectedPriceCents?: number; postId?: string },
  ): Promise<Order>;
  cancel(id: string): Promise<void>;
}
/** What a claim paid, as the server booked it. */
export interface ClaimReceipt {
  title: string;
  payoutCents: number;
  profitCents: number;
  cashCents: number;
}
export interface PortfolioService {
  /** Settle a claimable payout into cash: the server's receipt. */
  claim(positionId: string): Promise<ClaimReceipt>;
}
export interface ProfileService {
  list(): Trader[];
  get(id: string): Trader | undefined;
  /** Who follows them, and who they follow: undefined while loading. */
  followers(id: string): Trader[] | undefined;
  followingOf(id: string): Trader[] | undefined;
  toggleFollow(id: string): void;
  /** Be told when this trader posts a prediction. */
  toggleNotify(id: string): void;
}
export interface PostDraft {
  marketId: string;
  outcome: Outcome;
  text: string;
  confidence: Confidence;
  disclosePosition: boolean;
  audience: string;
}
export interface RoomDraft {
  name: string;
  description: string;
  privacy: "Public" | "Invite only";
  watchlist: string[];
  /** Show members' holdings on messages about linked markets. */
  disclosure?: boolean;
}
/** What an owner or moderator can change in 09.3. */
export type RoomPatch = Partial<
  Pick<Room, "rules" | "disclosure" | "description" | "notify">
>;
export type ReportReason = "spam" | "harassment" | "misleading" | "impersonation" | "other";
/** What a report is about: a post, comment or message by id, a person by
    their key, a room by its slug. */
export interface ReportSubject {
  type: "post" | "comment" | "message" | "user" | "room";
  id: string;
}
export interface SocialService {
  toggleLike(id: string): void;
  toggleBookmark(id: string): void;
  createPost(draft: PostDraft): Promise<Post>;
  comment(postId: string, text: string, parentId?: string): void;
  /** Post to a channel (the room's first chat channel by default),
      optionally with a linked market shown as a card. */
  roomMessage(
    roomId: string,
    text: string,
    channel?: string,
    marketId?: string,
    /** Reply in the thread under this message. */
    parentId?: string,
  ): void;
  markChannelRead(roomId: string, channel: string): void;
  toggleRoomMarket(roomId: string, marketId: string): void;
  /** Join or leave a public room; invite-only rooms take a request. */
  joinRoom(roomId: string): void;
  requestJoin(roomId: string): void;
  answerRequest(roomId: string, traderId: string, approve: boolean): void;
  setRole(roomId: string, traderId: string, role: RoomRole): void;
  removeMember(roomId: string, traderId: string): void;
  updateRoom(roomId: string, patch: RoomPatch): void;
  archiveRoom(roomId: string): void;
  createRoom(draft: RoomDraft): Promise<string>;
  /** Share markets to a room's watchlist; resolves to how many were new. */
  addRoomMarkets(roomId: string, marketIds: string[]): Promise<number>;
  /** Tell the moderators about something. */
  report(subject: ReportSubject, reason: ReportReason, note?: string): Promise<void>;
}
export interface WatchlistService {
  /** A new list, optionally starting with one market. */
  create(name: string, marketId?: string): Promise<string>;
  rename(id: string, name: string): void;
  remove(id: string): void;
  /** Add or remove a market; `SAVED_LIST` is the bookmark's list. */
  toggleMarket(listId: string, marketId: string): void;
  /** Put a market at a place in a list: reorders it, or puts it back. */
  place(listId: string, marketId: string, index: number): void;
}
export interface NotificationService {
  markRead(id: string): void;
  markAllRead(): void;
}
export interface SettingsService {
  update(patch: Partial<Settings>): void;
  /** `update`, awaited: rejects with the server's reason (a taken handle…). */
  save(patch: Partial<Settings>): Promise<void>;
  /** A new profile photo: straight to storage, then onto the profile. */
  uploadAvatar(file: File): Promise<void>;
  /** One of the illustrated avatars, in place of any photo. */
  chooseAvatar(preset: AvatarPreset): Promise<void>;
  /** Drops the photo: back to the illustrated avatar they were given. */
  removeAvatar(): Promise<void>;
  toggleNotification(id: string, channel: "app" | "email"): void;
  addAlert(alert: Omit<PriceAlert, "id">): void;
  removeAlert(id: string): void;
}
export interface DemoServices {
  markets: MarketService;
  orders: OrderService;
  portfolio: PortfolioService;
  profiles: ProfileService;
  social: SocialService;
  watchlists: WatchlistService;
  notifications: NotificationService;
  settings: SettingsService;
  getSnapshot(): DemoState;
  subscribe(listener: () => void): () => void;
  hydrate(): string | null;
  /** A new season: balance back to the start, once every 30 days. */
  reset(): Promise<void>;
  toggleWatchlist(id: string): void;
}
