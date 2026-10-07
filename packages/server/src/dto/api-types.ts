/**
 * What the API answers, as types for the browser: each is the return type of
 * the use case behind the route, so client and server can't drift apart.
 * Types only — nothing here runs.
 */
import type { listAlerts } from "../usecases/alerts";
import type { myInvites } from "../usecases/beta";
import type { clientConfig, waitlistConfig } from "../usecases/client-config";
import type { getMe } from "../usecases/me";
import type { listMarkets, marketBook, marketCandles, marketTrades, toMarketDTO } from "../usecases/markets";
import type { listNotifications, toNotificationDTO } from "../usecases/notifications";
import type { getTrader, listTraders, notificationPreferences, traderSummaries } from "../usecases/people";
import type { getActivity, getPortfolio } from "../usecases/portfolio";
import type { hydratePosts, listComments, listPosts } from "../usecases/posts";
import type { getRoom, listMessages, listRooms } from "../usecases/rooms";
import type { search } from "../usecases/search";
import type { leaderboard } from "../usecases/stats";
import type { listOrders, previewOrder } from "../usecases/trading";
import type { handleAvailability, waitlistSize, waitlistStatus } from "../usecases/waitlist";
import type { listWatchlists } from "../usecases/watchlists";
import type { buildWalletClaim, buildWalletOrder, submitWalletClaim, walletInfo } from "../usecases/wallet-trading";
import type { buildWithdrawal, submitWithdrawal } from "../usecases/withdraw";

type Out<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

export type ConfigDTO = Out<typeof clientConfig>;
export type WaitlistConfigDTO = Out<typeof waitlistConfig>;
export type MeDTO = Out<typeof getMe> & { access: { gated: boolean; granted: boolean } };
export type MarketDTO = ReturnType<typeof toMarketDTO>;
export type MarketPage = Out<typeof listMarkets>;
export type BookDTO = Out<typeof marketBook>;
export type TradesDTO = Out<typeof marketTrades>;
export type CandlesDTO = Out<typeof marketCandles>;
export type QuoteDTO = Out<typeof previewOrder>;
export type OrderDTO = Out<typeof listOrders>["items"][number];
export type PortfolioDTO = Out<typeof getPortfolio>;
export type ActivityDTO = Out<typeof getActivity>;
export type TraderSummaryDTO = Out<typeof traderSummaries>[number];
export type TraderDTO = Out<typeof getTrader>;
export type TraderPage = Out<typeof listTraders>;
export type PostDTO = Out<typeof hydratePosts>[number];
export type FeedPage = Out<typeof listPosts>;
export type CommentDTO = Out<typeof listComments>["items"][number];
export type RoomSummaryDTO = Out<typeof listRooms>["items"][number];
export type RoomDTO = Out<typeof getRoom>;
export type MessagesDTO = Out<typeof listMessages>;
export type WatchlistsDTO = Out<typeof listWatchlists>;
export type NotificationDTO = ReturnType<typeof toNotificationDTO>;
export type NotificationsPage = Out<typeof listNotifications>;
export type PreferencesDTO = Out<typeof notificationPreferences>;
export type AlertsDTO = Out<typeof listAlerts>;
export type LeaderboardDTO = Out<typeof leaderboard>;
export type SearchDTO = Out<typeof search>;
export type InvitesDTO = Out<typeof myInvites>;
export type HandleAvailabilityDTO = Out<typeof handleAvailability>;
export type WaitlistStatusDTO = Out<typeof waitlistStatus>;
export type WaitlistSizeDTO = Out<typeof waitlistSize>;
/** A wallet order to sign: the order, its estimate and the transaction. */
export type WalletOrderDTO = Out<typeof buildWalletOrder>;
export type WalletClaimDTO = Out<typeof buildWalletClaim>;
export type WalletClaimReceiptDTO = Out<typeof submitWalletClaim>;
export type WalletDTO = Out<typeof walletInfo>;
export type WithdrawalDTO = Out<typeof buildWithdrawal>;
export type WithdrawalReceiptDTO = Out<typeof submitWithdrawal>;
