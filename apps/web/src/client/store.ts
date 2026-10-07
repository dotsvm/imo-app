/**
 * The screens' data, from the API. It keeps the service contract the screens
 * were built on — synchronous reads over a snapshot — and fills that snapshot
 * from /api/v1: what a screen asks for loads on first read, changes go to the
 * server (shown at once, undone if the server says no), and realtime keeps it
 * current. Nothing here invents data: an empty cache means "loading".
 */
import type {
  BookLevel,
  DemoState,
  Market,
  Order,
  Outcome,
  Post,
  PriceAlert,
  Quote,
  RecentTrade,
  Room,
  RoomRole,
  Settings,
  Side,
  Trader,
} from "@imo/domain/types";
import type {
  ActivityDTO,
  AlertsDTO,
  BookDTO,
  CandlesDTO,
  ConfigDTO,
  FeedPage,
  LeaderboardDTO,
  MarketDTO,
  MarketPage,
  MeDTO,
  MessagesDTO,
  NotificationDTO,
  NotificationsPage,
  OrderDTO,
  PortfolioDTO,
  PostDTO,
  PreferencesDTO,
  QuoteDTO,
  RoomDTO,
  RoomSummaryDTO,
  SearchDTO,
  TradesDTO,
  TraderDTO,
  TraderPage,
  WatchlistsDTO,
} from "@imo/server/dto/api-types";
import type {
  ClaimReceipt,
  DemoServices,
  HistoryRange,
  MarketFilters,
  PostDraft,
  PricePoint,
  RoomDraft,
  RoomPatch,
  TicketRequest,
} from "@imo/domain/demo/contracts";
import { ApiRequestError, api, query } from "./http";
import {
  People,
  YOU,
  emptyRecord,
  toClosed,
  toComment,
  toFullTrader,
  toMarket,
  toMessage,
  toNotification,
  toOrder,
  toPosition,
  toPost,
  toRoom,
  toTrader,
  type RoomMeta,
} from "./normalize";
import { setDataSnapshot } from "@/data/clock";
import { RealtimeClient, type Transport } from "./realtime";
import {
  callbackUrl,
  devSubject,
  injectedWallet,
  rememberSignedOut,
  signedOutHere,
  signInMethods,
  supabaseClient,
  type SignInMethods,
  type WalletChain,
} from "./auth";
import { onAccessRequired, onSessionExpired } from "./http";
import type { EthereumWallet, SolanaWallet } from "@supabase/supabase-js";

/** The snapshot: the screens' DemoState, plus what only the server knows. */
export interface ClientState extends DemoState {
  /** Cash held for resting orders, as the server counts it. */
  reservedCents: number;
  signedIn: boolean;
  /** Known to be signed out (the API said so) — not merely not loaded yet,
      or unreachable for a moment. */
  signedOut: boolean;
  access: { gated: boolean; granted: boolean };
  /** The sign-in dialog, when something asked for an account: why, and
      what went wrong coming back from a provider, if anything. */
  authPrompt: { reason: string | null; problem: string | null } | null;
  /** The account behind the session, for Settings → Account. */
  account: {
    method: string | null;
    emailVerified: boolean;
    role: "user" | "admin";
    wallets: MeDTO["wallets"];
  };
  claimable: { positionId: string; payoutCents: number }[];
}

export interface ApiServices extends DemoServices {
  start(): Promise<void>;
  stop(): void;
  getSnapshot(): ClientState;
  /** The last thing that went wrong in the background, for a banner. */
  problem(): string | null;
  /** Keep something live while a screen shows it (returns the way to stop). */
  watch(kind: "market" | "room" | "post" | "trader", id: string): () => void;
  /** Asked for and not answered yet: the screen shows its skeleton, not
      "isn't available" (that's for what the server says isn't there). */
  pending(kind: "market" | "room" | "post", id: string): boolean;
  config(): ConfigDTO | null;
  roomMeta(slug: string): RoomMeta | undefined;
  /** Load a thread's replies. */
  loadThread(roomId: string, channel: string, parentId: string): void;
  /** Signing in and out, and getting past the private beta. */
  auth: {
    methods(): SignInMethods;
    /** Off to Google, Apple or X; back through /api/v1/auth/callback to `next`. */
    oauth(provider: "google" | "apple" | "x", next: string): Promise<void>;
    /** Sign a one-time message with a Solana or Ethereum wallet. */
    wallet(chain: WalletChain): Promise<void>;
    /** Email a sign-in link ("sent"); dev sessions sign in on the spot. */
    email(address: string, next: string): Promise<"sent" | "signed-in">;
    /** The demo's sample trader. */
    demo(): Promise<void>;
    redeem(code: string): Promise<void>;
    waitlist(email: string): Promise<void>;
    /** Ends every session this browser holds, then the page starts over. */
    signOut(): Promise<void>;
    /** Open the sign-in dialog (`reason`: what they were doing). */
    prompt(reason?: string | null, problem?: string | null): void;
    dismiss(): void;
  };
}

/** The demo's sample trader: the design's viewer. */
const DEMO_TRADER = { subject: "you", name: "Jordan Reyes" };

const at = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const RETRY_AFTER_MS = 30_000;

function emptyState(): ClientState {
  return {
    version: 1,
    cashCents: 0,
    reservedCents: 0,
    positions: [],
    closed: [],
    orders: [],
    activity: [],
    watchlist: [],
    watchlists: [],
    following: [],
    notifyTraders: [],
    liked: [],
    bookmarked: [],
    posts: [],
    rooms: [],
    channelReads: {},
    notifications: [],
    readNotifications: [],
    claimable: [],
    signedIn: false,
    signedOut: false,
    authPrompt: null,
    access: { gated: false, granted: true },
    account: { method: null, emailVerified: false, role: "user", wallets: [] },
    settings: {
      interests: [],
      onboarded: true,
      displayName: "",
      handle: "",
      bio: "",
      email: "",
      region: "",
      theme: "Midnight",
      priceInCents: true,
      showPositionsOnPosts: true,
      appearOnLeaderboard: true,
      privateOpenPositions: false,
      notifications: [],
      alerts: [],
    },
  };
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** "$12.50" / "12.5" / "12" → cents; shares are whole numbers. */
const parseAmount = (text: string) => {
  const value = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : NaN;
};

export function createApiServices(): ApiServices {
  const people = new People();
  let state = emptyState();
  let cfg: ConfigDTO | null = null;
  const listeners = new Set<() => void>();
  let problem: string | null = null;
  let problemTimer: ReturnType<typeof setTimeout> | undefined;
  let realtime: RealtimeClient | undefined;

  // Caches the snapshot is built from.
  const markets = new Map<string, Market>();
  let catalog: string[] = [];
  const books = new Map<string, { bids: BookLevel[]; asks: BookLevel[] }>();
  const trades = new Map<string, RecentTrade[]>();
  const traders = new Map<string, Trader>();
  const fullTraders = new Set<string>();
  const posts = new Map<string, Post>();
  const rooms = new Map<string, Room>();
  const roomMeta = new Map<string, RoomMeta>();
  /** Quotes by ticket. `stale`: past its few seconds, kept on screen (and
      usable) while the next one loads — a refresh never blanks the ticket. */
  const quotes = new Map<string, { quote?: Quote; error?: ApiRequestError; stale?: boolean }>();
  const latestQuote = new Map<string, Quote>();
  const inflight = new Map<string, Promise<unknown>>();
  const failedAt = new Map<string, number>();
  const loaded = new Set<string>();

  // ------------------------------------------------------------- plumbing
  let pending = false;
  const build = () => {
    state = {
      ...state,
      posts: [...posts.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      rooms: [...rooms.values()],
    };
  };
  /** Many changes in a tick become one render. */
  const changed = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      build();
      listeners.forEach((fn) => fn());
    });
  };
  const set = (patch: Partial<ClientState>) => {
    state = { ...state, ...patch };
    changed();
  };

  /** Taking part needs an account: the dialog opens, and the caller gets a
      reason it can show. */
  const needAccount = (reason: string | null = null) => {
    if (!state.authPrompt) set({ authPrompt: { reason, problem: null } });
    return new ApiRequestError(401, "sign_in_required", "Log in or sign up to continue.");
  };
  const report = (error: unknown) => {
    if ((error as Error)?.name === "AbortError") return;
    problem = error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
    clearTimeout(problemTimer);
    problemTimer = setTimeout(() => {
      problem = null;
      changed();
    }, 6_000);
    changed();
  };

  /** One request per key at a time. */
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = load()
      .then((value) => {
        loaded.add(key);
        failedAt.delete(key);
        return value;
      })
      .catch((error: unknown) => {
        failedAt.set(key, Date.now());
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  /** Load in the background after a render asked for it; failures wait a bit. */
  const lazily = (key: string, load: () => Promise<unknown>) => {
    if (loaded.has(key) || inflight.has(key)) return;
    const failed = failedAt.get(key);
    if (failed && Date.now() - failed < RETRY_AFTER_MS) return;
    queueMicrotask(() => void once(key, load).catch(() => {}));
  };

  /** Show a change now; undo it if the server refuses. */
  const optimistic = <T>(apply: () => (() => void) | void, send: () => Promise<T>, after?: (result: T) => void) => {
    if (!state.signedIn) return Promise.reject(needAccount());
    const undo = apply();
    changed();
    return send()
      .then((result) => {
        after?.(result);
        changed();
        return result;
      })
      .catch((error: unknown) => {
        undo?.();
        report(error);
        changed();
        throw error;
      });
  };
  const fire = (p: Promise<unknown>) => void p.catch(() => {});
  /** Changes made to each room here, counted when applied and when answered:
      a reload that began before one may land after it, and would put the
      room back as it was. */
  const roomEdits = new Map<string, number>();
  const touchRoom = (slug: string) => roomEdits.set(slug, (roomEdits.get(slug) ?? 0) + 1);
  const editRoom = <T>(
    slug: string,
    apply: () => (() => void) | void,
    send: () => Promise<T>,
    after?: (result: T) => void,
  ) =>
    optimistic(
      () => {
        touchRoom(slug);
        return apply();
      },
      () => send().finally(() => touchRoom(slug)),
      after,
    );

  // -------------------------------------------------------------- loaders
  const putMarket = (dto: MarketDTO) => {
    markets.set(dto.id, toMarket(dto));
  };
  /** Load every market in `ids` that isn't cached yet, in batches. Lists
      wait for this, so a screen never shows an item without its market. */
  const marketLoads = new Map<string, Promise<void>>();
  const ensureMarkets = async (ids: Iterable<string>) => {
    const wanted = [...new Set(ids)].filter((id) => id && !markets.has(id));
    // Another list may already be asking for some of these: wait for it.
    const pending = wanted.flatMap((id) => marketLoads.get(id) ?? []);
    const missing = wanted.filter((id) => !marketLoads.has(id));
    const load = (async () => {
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        const page = await api<MarketPage>(`markets${query({ ids: batch.join(","), status: "all", limit: 100 })}`);
        page.items.forEach(putMarket);
      }
      // Hidden markets (closed before the catalog began) load one by one.
      const hidden = missing.filter((id) => !markets.has(id));
      await Promise.all(
        hidden.slice(0, 20).map((id) =>
          api<MarketDTO>(`markets/${id}`)
            .then(putMarket)
            .catch(() => undefined),
        ),
      );
    })();
    for (const id of missing) marketLoads.set(id, load);
    try {
      await Promise.all([load, ...new Set(pending)]);
    } finally {
      for (const id of missing) if (marketLoads.get(id) === load) marketLoads.delete(id);
    }
  };

  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "·";
  const zero = () => ({ returnPct: 0, correct: 0, resolved: 0, trades: 0, pnlCents: 0, startingCapitalCents: 0 });
  const placeholders = new Map<string, Trader>();
  /** Someone whose profile is on its way: their handle, no numbers yet. */
  const placeholder = (key: string): Trader => {
    const name = key === YOU ? state.settings.displayName || state.settings.handle || "You" : people.handle(key);
    const known = placeholders.get(key);
    if (known && known.name === name) return known;
    const t: Trader = {
      id: key,
      name,
      handle: key === YOU ? state.settings.handle : people.handle(key),
      initials: initialsOf(name),
      color: "",
      pending: true,
      bio: "",
      interests: [],
      focus: "",
      joined: "",
      venueId: "kalshi",
      followers: 0,
      following: 0,
      rooms: 0,
      privatePositions: false,
      record: emptyRecord(),
      stats: { "7D": zero(), "30D": zero(), "90D": zero(), All: zero() },
      categories: {},
      history: [],
    };
    placeholders.set(key, t);
    return t;
  };
  const missingPeople = new Set<string>();

  const putTrader = (dto: Parameters<typeof toTrader>[1]) => {
    const key = people.remember(dto);
    traders.set(key, toTrader(people, dto, traders.get(key)));
    return key;
  };
  const putPost = (dto: PostDTO) => {
    putTrader(dto.author);
    for (const c of dto.comments) if (c.author) putTrader(c.author);
    posts.set(dto.id, toPost(people, dto, posts.get(dto.id)));
    if (dto.viewer) {
      state.liked = dto.viewer.liked ? [...new Set([...state.liked, dto.id])] : state.liked.filter((x) => x !== dto.id);
      state.bookmarked = dto.viewer.bookmarked ? [...new Set([...state.bookmarked, dto.id])] : state.bookmarked.filter((x) => x !== dto.id);
    }
  };
  /** Rooms a screen shows, and the live feeds of those you belong to. Only
      members may listen to a room: asking for one you're not in would be
      refused, and take every other live update down with it. */
  const shownRooms = new Map<string, number>();
  const roomFeeds = new Map<string, () => void>();
  const syncRoomFeed = (slug: string) => {
    const meta = roomMeta.get(slug);
    const want = (shownRooms.get(slug) ?? 0) > 0 && !!meta?.role && !meta.locked && !!realtime;
    if (want && !roomFeeds.has(slug)) roomFeeds.set(slug, realtime!.watch(meta!.realtime));
    if (!want && roomFeeds.has(slug)) {
      roomFeeds.get(slug)!();
      roomFeeds.delete(slug);
    }
  };
  const putRoom = (dto: RoomSummaryDTO | RoomDTO) => {
    const { room, meta } = toRoom(people, dto, rooms.get(dto.id));
    if ("members" in dto && Array.isArray(dto.members)) dto.members.forEach((m) => putTrader(m));
    rooms.set(room.id, room);
    roomMeta.set(room.id, { ...roomMeta.get(room.id), ...meta });
    // Joined, left or let in: the live feed follows membership.
    syncRoomFeed(room.id);
    // Read markers live on the snapshot the way the screens expect them.
    if (Object.keys(meta.lastRead).length) {
      const reads = { ...state.channelReads };
      for (const [channel, when] of Object.entries(meta.lastRead)) if (when) reads[`${room.id}/${channel}`] = when;
      state.channelReads = reads;
    }
  };

  const loadMe = async () => {
    const me = await api<MeDTO>("me");
    people.setViewer(me.user.id, me.user.handle);
    set({
      signedIn: true,
      signedOut: false,
      access: me.access,
      account: {
        method: me.signIn.method,
        emailVerified: me.settings.emailVerified,
        role: me.user.role,
        wallets: me.wallets,
      },
      cashCents: me.account.cashCents,
      reservedCents: me.account.reservedCents,
      season: {
        startingBalanceCents: me.account.startingBalanceCents,
        number: me.account.season,
        nextResetAt: state.season?.nextResetAt ?? null,
      },
      settings: {
        ...state.settings,
        interests: me.settings.interests as Settings["interests"],
        onboarded: me.settings.onboarded,
        displayName: me.user.displayName,
        handle: me.user.handle,
        bio: me.user.bio,
        email: me.settings.email ?? "",
        region: me.user.region ?? "",
        theme: me.settings.theme,
        priceInCents: me.settings.priceInCents,
        showPositionsOnPosts: me.settings.showPositionsOnPosts,
        appearOnLeaderboard: me.settings.appearOnLeaderboard,
        privateOpenPositions: me.settings.privateOpenPositions,
      },
    });
    return me;
  };
  const loadPortfolio = async () => {
    const p = await api<PortfolioDTO>("portfolio");
    await ensureMarkets([...p.positions.map((x) => x.marketId), ...p.closed.map((x) => x.marketId)]);
    set({
      cashCents: p.account.cashCents,
      reservedCents: p.account.reservedCents,
      season: {
        startingBalanceCents: p.account.startingBalanceCents,
        number: p.account.season,
        nextResetAt: p.account.nextResetAt,
      },
      positions: p.positions.map(toPosition),
      closed: p.closed.map(toClosed),
      claimable: p.claims.map((c) => ({ positionId: c.positionId, payoutCents: c.payoutCents })),
    });
  };
  const loadActivity = async () => set({ activity: (await api<ActivityDTO>("portfolio/activity")).items as ClientState["activity"] });
  const loadOrders = async () => {
    const { items } = await api<{ items: OrderDTO[] }>("orders");
    await ensureMarkets(items.map((o) => o.quote.marketId as string));
    set({ orders: items.map(toOrder) });
  };
  const loadWatchlists = async () => {
    const { items } = await api<WatchlistsDTO>("watchlists");
    await ensureMarkets(items.flatMap((l) => l.marketIds));
    const saved = items.find((l) => l.isDefault);
    set({
      watchlist: saved?.marketIds ?? [],
      watchlists: items.filter((l) => !l.isDefault).map((l) => ({ id: l.id, name: l.name, marketIds: l.marketIds, updatedAt: l.updatedAt })),
    });
  };
  const loadFollowing = async () => {
    const { items } = await api<{ items: Parameters<typeof toTrader>[1][] }>("me/following");
    const keys = items.map((t) => putTrader(t));
    set({ following: keys, notifyTraders: items.filter((t) => t.viewer?.notify).map((t) => people.key(t.id)) });
  };
  const loadNotifications = async () => {
    const page = await api<NotificationsPage>(`notifications${query({ limit: 100 })}`);
    set({
      notifications: page.items.map(toNotification),
      readNotifications: page.items.filter((n) => n.read).map((n) => n.id),
    });
  };
  const loadPreferences = async () => {
    const { items } = await api<PreferencesDTO>("me/notification-preferences");
    set({ settings: { ...state.settings, notifications: items } });
  };
  const loadAlerts = async () => {
    const { items } = await api<AlertsDTO>("alerts");
    await ensureMarkets(items.map((a) => a.marketId));
    set({
      settings: {
        ...state.settings,
        alerts: items
          .filter((a) => a.active)
          .map((a): PriceAlert => ({ id: a.id, marketId: a.marketId, outcome: a.outcome, thresholdCents: a.thresholdCents, direction: a.direction })),
      },
    });
  };
  /** The board is asked for again this long after it last arrived: the
      worker reprices every listed market every few minutes. */
  const CATALOG_FRESH_MS = 60_000;
  let catalogAt = 0;
  const loadCatalog = async () => {
    const page = await api<MarketPage>(`markets${query({ limit: 100, sort: "trending", status: "all" })}`);
    page.items.forEach(putMarket);
    catalog = page.items.map((m) => m.id);
    catalogAt = Date.now();
    changed();
  };
  const loadFeed = async () => {
    const feeds = state.signedIn ? (["latest", "following", "bookmarks"] as const) : (["latest"] as const);
    const pages = await Promise.all(feeds.map((feed) => api<FeedPage>(`posts${query({ feed, limit: 50 })}`)));
    const items = pages.flatMap((page) => page.items);
    await ensureMarkets(items.map((p) => p.marketId));
    items.forEach(putPost);
    changed();
  };
  /** One screen's predictions (a market's, a trader's), into the shared set. */
  const loadPosts = async (params: Record<string, string>) => {
    const page = await api<FeedPage>(`posts${query({ ...params, limit: 50 })}`);
    await ensureMarkets(page.items.map((p) => p.marketId));
    page.items.forEach(putPost);
    changed();
  };
  const loadRooms = async () => {
    const { items } = await api<{ items: RoomSummaryDTO[] }>(`rooms${query({ limit: 100 })}`);
    items.forEach(putRoom);
    changed();
  };
  const loadTraders = async () => {
    const { items } = await api<TraderPage>(`traders${query({ limit: 50 })}`);
    items.forEach((t) => putTrader(t));
    changed();
  };

  /** Every ranked trader's numbers for each period, so the boards and the
      ticker can sort without opening each profile. */
  const loadLeaderboards = async () => {
    const periods = ["7D", "30D", "90D", "All"] as const;
    const boards = await Promise.all(
      periods.map((period) => api<LeaderboardDTO>(`leaderboard${query({ period, sample: "off", limit: 100 })}`)),
    );
    set({ leaderboardAt: boards[1].updatedAt });
    boards.forEach((board, i) => {
      for (const row of board.items) {
        const key = putTrader(row.trader);
        const t = traders.get(key)!;
        traders.set(key, {
          ...t,
          stats: { ...t.stats, [periods[i]]: row.stats },
          // A full profile's record is the authority once it has loaded.
          record: fullTraders.has(key) ? t.record : { ...t.record, ...row.record },
        });
      }
    });
    changed();
  };

  const loadRoom = async (slug: string): Promise<void> => {
    const edits = roomEdits.get(slug) ?? 0;
    // Changed here while this was on its way: its answer may predate that.
    const stale = () => (roomEdits.get(slug) ?? 0) !== edits;
    const detail = await api<RoomDTO>(`rooms/${slug}`);
    if (stale()) return reload(`room:${slug}`, () => loadRoom(slug));
    putRoom(detail);
    if (!("locked" in detail) || detail.locked) return changed();
    // Every chat channel's latest page, and the threads under it.
    const pages = await Promise.all(
      detail.channels
        .filter((c) => c.id !== "predictions")
        .map((c) => api<MessagesDTO>(`rooms/${slug}/channels/${c.id}/messages${query({ limit: 100 })}`).then((page) => ({ c, page }))),
    );
    const messages = pages.flatMap(({ page }) => ("items" in page ? page.items : []));
    const threads = await Promise.all(
      pages.flatMap(({ c, page }) =>
        ("items" in page ? page.items : [])
          .filter((m) => m.replies && m.replies.count > 0)
          .map((m) => api<MessagesDTO>(`rooms/${slug}/channels/${c.id}/messages${query({ thread: m.id })}`)),
      ),
    );
    const replies = threads.flatMap((t) => ("items" in t ? t.items : []));
    for (const m of [...messages, ...replies]) if (m.author) putTrader(m.author);
    await ensureMarkets([
      ...detail.watchlist,
      ...detail.channels.map((c) => c.marketId).filter((id): id is string => !!id),
      ...[...messages, ...replies].map((m) => ("marketId" in m ? m.marketId : undefined)).filter((id): id is string => !!id),
    ]);
    if (stale()) return reload(`room:${slug}`, () => loadRoom(slug));
    const room = rooms.get(slug);
    if (room)
      rooms.set(slug, {
        ...room,
        messages: [...messages, ...replies]
          .map((m) => toMessage(people, m as Parameters<typeof toMessage>[1]))
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      });
    // Predictions posted to the room, or public on its markets.
    const feed = await api<FeedPage>(`posts${query({ room: slug, limit: 50 })}`);
    await ensureMarkets(feed.items.map((p) => p.marketId));
    feed.items.forEach(putPost);
    changed();
  };

  // ---------------------------------------------------------------- reads
  const marketGet = (id: string) => {
    const market = markets.get(id);
    if (!market && id) lazily(`market:${id}`, async () => putMarket(await api<MarketDTO>(`markets/${encodeURIComponent(id)}`)));
    return market;
  };
  /** A whole profile — record, history, categories — for the screens that
      show one (a profile, a prediction's author). */
  const loadFull = (key: string) => {
    // The viewer's handle is known once /me answers; until then, wait.
    const ready = key !== YOU || people.viewerId !== null;
    if (!fullTraders.has(key) && ready && !missingPeople.has(key))
      lazily(`trader:${key}`, async () => {
        const handle = key === YOU ? state.settings.handle : people.handle(key);
        try {
          const dto = await api<TraderDTO>(`traders/${encodeURIComponent(handle)}`);
          await ensureMarkets(dto.history.map((h) => h.marketId));
          const k = people.remember(dto);
          traders.set(k, toFullTrader(people, dto, traders.get(k)));
          fullTraders.add(k);
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 404) missingPeople.add(key);
          else throw error;
        } finally {
          changed();
        }
      });
  };
  /** A handle in a link can name the viewer: their key is YOU, so their
      own profile opens on their record, not a stand-in that never fills. */
  const keyOf = (key: string) =>
    key !== YOU && people.viewerId !== null && people.handle(YOU).toLowerCase() === key.toLowerCase() ? YOU : key;
  /** Someone as the lists know them. Only a person no list has mentioned
      is looked up on sight; everyone else's numbers came with the list. */
  const traderGet = (asked: string): Trader | undefined => {
    const key = keyOf(asked);
    if (!traders.has(key)) loadFull(key);
    if (missingPeople.has(key)) return traders.get(key);
    return traders.get(key) ?? placeholder(key);
  };
  const lists = new Map<string, string[]>();
  const holders = new Map<string, { key: string; outcome: Outcome; shares: number }[]>();
  const queries = new Map<string, string[]>();
  const searches = new Map<string, { markets: string[]; traders: string[]; rooms: string[] }>();
  const searchFailed = new Set<string>();
  /** A person's followers or followings, as keys into the people cache. */
  const followList = (kind: "followers" | "following", key: string) => {
    const name = `${kind}:${key}`;
    lazily(name, async () => {
      const handle = key === YOU ? state.settings.handle : people.handle(key);
      const { items } = await api<TraderPage>(`traders/${encodeURIComponent(handle)}/${kind}${query({ limit: 100 })}`);
      lists.set(name, items.map((t) => putTrader(t)));
      changed();
    });
    return lists.get(name)?.map((k) => traders.get(k) ?? placeholder(k));
  };

  /** The tape is asked for again this long after it last arrived. */
  const TAPE_FRESH_MS = 15_000;
  const tradesAt = new Map<string, number>();
  const related = new Map<string, string[]>();
  /** A chart's history is reused for a few minutes, then asked for again. */
  const HISTORY_FRESH_MS = 5 * 60_000;
  const histories = new Map<string, { points: PricePoint[] | null; at: number }>();
  const loadHistory = async (key: string, id: string, range: HistoryRange) => {
    try {
      const page = await api<CandlesDTO>(`markets/${id}/candles${query({ range })}`);
      const points = page.points.map((p) => ({ at: Date.parse(p.t), yes: p.yes }));
      histories.set(key, { points, at: Date.now() });
    } catch (error) {
      // Keep what was drawn; with nothing drawn yet, say it's unavailable.
      if (!histories.get(key)?.points) histories.set(key, { points: null, at: Date.now() });
      throw error;
    } finally {
      changed();
    }
  };

  const loadBook = async (id: string) => {
    const book = await api<BookDTO>(`markets/${id}/book`);
    books.set(id, { bids: book.bids, asks: book.asks });
    changed();
  };

  // --------------------------------------------------------------- realtime
  const refresh = new Map<string, ReturnType<typeof setTimeout>>();
  /** Bursts of events become one reload per slice. */
  const reload = (name: string, load: () => Promise<unknown>) => {
    clearTimeout(refresh.get(name));
    refresh.set(
      name,
      setTimeout(() => void load().catch(() => {}), 300),
    );
  };
  const onRealtime = (channel: string, event: string, payload: unknown) => {
    const [kind, id] = channel.split(":");
    if (kind === "user") {
      if (event === "order" || event === "portfolio") {
        reload("portfolio", loadPortfolio);
        reload("orders", loadOrders);
        reload("activity", loadActivity);
      }
      if (event === "notification") {
        const n = payload as NotificationDTO;
        if (!state.notifications.some((x) => x.id === n.id)) set({ notifications: [toNotification(n), ...state.notifications] });
        // Let into a room (or anything else about one) while it's on screen:
        // show it as it now is.
        const slug = n.href?.match(/^\/rooms\/([^/?#]+)/)?.[1];
        if (slug && shownRooms.has(slug)) reload(`room:${slug}`, () => loadRoom(slug));
      }
    }
    if (kind === "market" && id) {
      if (event === "quote") {
        const q = payload as { yesBidCents: number | null; yesAskCents: number | null; yesPriceCents: number | null };
        const m = markets.get(id);
        if (m && q.yesPriceCents !== null)
          markets.set(id, { ...m, yesPrice: q.yesPriceCents, yesBid: q.yesBidCents, yesAsk: q.yesAskCents } as Market);
        changed();
      }
      if (event === "book") {
        const b = payload as { bids: BookLevel[]; asks: BookLevel[] };
        books.set(id, { bids: b.bids, asks: b.asks });
        changed();
      }
      if (event === "status" || event === "resolved") reload(`market:${id}`, async () => putMarket(await api<MarketDTO>(`markets/${id}`)));
    }
    if (kind === "room") {
      const slug = [...roomMeta.entries()].find(([, meta]) => meta.realtime === channel)?.[0];
      if (!slug) return;
      if (event === "message" || event === "message.updated") {
        const dto = payload as Parameters<typeof toMessage>[1];
        if (dto.author) putTrader(dto.author);
        if (dto.marketId && !markets.has(dto.marketId)) void ensureMarkets([dto.marketId]).then(changed);
        const m = toMessage(people, dto);
        const room = rooms.get(slug);
        if (room) {
          const messages = room.messages.some((x) => x.id === m.id)
            ? room.messages.map((x) => (x.id === m.id ? m : x))
            : [...room.messages, m];
          rooms.set(slug, { ...room, messages });
          changed();
        }
      } else if (event === "message.deleted") {
        const { id: gone } = payload as { id: string };
        const room = rooms.get(slug);
        if (room) {
          rooms.set(slug, { ...room, messages: room.messages.filter((x) => x.id !== gone) });
          changed();
        }
      } else reload(`room:${slug}`, () => loadRoom(slug));
    }
    if (kind === "post" && id && event === "comment")
      reload(`post:${id}`, async () => {
        putPost(await api<PostDTO>(`posts/${id}`));
        changed();
      });
  };

  // --------------------------------------------------------------- tickets
  const ticketBase = (r: TicketRequest) => `${r.marketId}|${r.side}|${r.outcome}|${r.type}|${r.limitCents ?? ""}`;
  const ticketKey = (r: TicketRequest) => `${ticketBase(r)}|${r.input}`;
  const ticketBody = (r: TicketRequest) => {
    const buy = r.side === "Buy";
    const amount = parseAmount(r.input);
    const shares = Math.floor(Number(r.input.replace(/[,\s]/g, "")));
    return {
      market: r.marketId,
      side: r.side,
      outcome: r.outcome,
      type: r.type === "Limit" ? ("limit" as const) : ("market" as const),
      ...(buy ? { amountCents: amount } : { shares }),
      ...(r.type === "Limit" && r.limitCents !== undefined ? { limitCents: r.limitCents } : {}),
    };
  };

  /** Your avatar, photo or illustration, everywhere it shows. */
  const showAvatar = (url: string | null) => {
    const you = traders.get(YOU);
    if (!you) return;
    const { avatarUrl: _old, ...rest } = you;
    void _old;
    traders.set(YOU, url ? { ...rest, avatarUrl: url } : rest);
    changed();
  };

  // ---------------------------------------------------------------- session
  /** Who's signed in, then everything the screens share. Runs again after
      signing in on the page (a wallet, the demo) or getting past the beta. */
  const enter = async ({ demo = false } = {}) => {
    try {
      await loadMe();
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
      // With no real sign-in to offer, the demo opens as its sample trader —
      // unless you signed out of it here.
      if (demo && cfg?.auth.dev && !cfg.supabase && !signedOutHere()) {
        await api("dev/session", { body: DEMO_TRADER });
        await loadMe();
      } else {
        set({ signedIn: false, signedOut: true });
        // Signed out, the app is still all there to read: the feed, markets,
        // people, rooms. Live prices too; personal channels wait for sign-in.
        if (!realtime)
          realtime = new RealtimeClient(cfg!.realtime as Transport, onRealtime, {
            supabase: cfg!.supabase ? () => supabaseClient(cfg!) : undefined,
          });
        await Promise.all(
          [
            once("catalog", loadCatalog),
            once("feed", loadFeed),
            once("rooms", loadRooms),
            once("traders", loadTraders),
            once("leaderboards", loadLeaderboards),
          ].map((p) => p.catch(() => {})),
        );
        return;
      }
    }
    if (state.access.gated && !state.access.granted) return;
    if (!realtime) {
      realtime = new RealtimeClient(cfg!.realtime as Transport, onRealtime, {
        userId: people.viewerId,
        supabase: cfg!.supabase ? () => supabaseClient(cfg!) : undefined,
      });
      realtime.watch("user:me");
    }
    await Promise.all([
      once("portfolio", loadPortfolio),
      once("activity", loadActivity),
      once("orders", loadOrders),
      once("watchlists", loadWatchlists),
      once("following", loadFollowing),
      once("notifications", loadNotifications),
      once("preferences", loadPreferences),
      once("alerts", loadAlerts),
      once("catalog", loadCatalog),
      once("feed", loadFeed),
      once("rooms", loadRooms),
      once("traders", loadTraders),
      once("leaderboards", loadLeaderboards),
    ]);
    loadFull(YOU);
  };
  /** Signed in on the page: start it over as them — everything read while
      signed out (the feed, rooms, follows) now reads differently. */
  const signedIn = async () => {
    rememberSignedOut(false);
    const url = new URL(window.location.href);
    for (const param of ["login", "signin", "signedin"]) url.searchParams.delete(param);
    window.location.replace(url.toString());
    // The page is going; keep the caller waiting rather than flashing.
    await new Promise(() => {});
  };
  const supabase = () => {
    if (!cfg?.supabase) throw new ApiRequestError(404, "unavailable", "Sign-in isn't set up on this deployment.");
    return supabaseClient(cfg);
  };
  /** Supabase's errors, in words for the sign-in screen. */
  const authError = (error: { message?: string; code?: string } | null | undefined, fallback: string) =>
    new ApiRequestError(400, error?.code ?? "sign_in_failed", error?.message || fallback);

  // -------------------------------------------------------------- service
  const services: ApiServices = {
    async start() {
      cfg = await api<ConfigDTO>("config");
      setDataSnapshot(cfg.dataSnapshot);
      onSessionExpired(() => {
        if (state.signedIn) set({ signedIn: false, signedOut: true });
      });
      onAccessRequired(() => {
        if (!state.authPrompt) set({ authPrompt: { reason: "beta", problem: null } });
      });
      await enter({ demo: true });
    },
    stop() {
      realtime?.close();
    },
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    hydrate: () => null,
    problem: () => problem,
    config: () => cfg,
    auth: {
      methods: () => signInMethods(cfg),
      async oauth(provider, next) {
        const { error } = await (await supabase()).auth.signInWithOAuth({
          // Supabase names X "x" or, in older projects, "twitter".
          provider: provider === "x" ? ((cfg?.auth.xProvider ?? "x") as "x" | "twitter") : provider,
          options: { redirectTo: callbackUrl(next) },
        });
        const name = provider === "x" ? "X" : provider === "apple" ? "Apple" : "Google";
        if (error) throw authError(error, `${name} sign-in couldn't start. Try again.`);
      },
      async wallet(chain) {
        const wallet = injectedWallet(chain);
        if (!wallet)
          throw new ApiRequestError(
            404,
            "no_wallet",
            chain === "solana"
              ? "No Solana wallet found in this browser. Install Phantom, or open imo in your wallet's browser."
              : "No Ethereum wallet found in this browser. Install MetaMask, or open imo in your wallet's browser.",
          );
        const client = await supabase();
        const statement = "Sign in to imo. This proves you own this wallet; it costs nothing and moves no funds.";
        const { error } =
          chain === "solana"
            ? await client.auth.signInWithWeb3({ chain: "solana", statement, wallet: wallet as SolanaWallet })
            : await client.auth.signInWithWeb3({ chain: "ethereum", statement, wallet: wallet as EthereumWallet });
        if (error) throw authError(error, "The wallet didn't sign in. Try again.");
        await signedIn();
      },
      async email(address, next) {
        if (cfg?.supabase && cfg.auth.email) {
          const { error } = await (await supabase()).auth.signInWithOtp({
            email: address.trim(),
            options: { emailRedirectTo: callbackUrl(next), shouldCreateUser: true },
          });
          if (error) throw authError(error, "That link couldn't be sent. Try again.");
          return "sent";
        }
        if (!cfg?.auth.dev) throw new ApiRequestError(404, "unavailable", "Email sign-in isn't set up on this deployment.");
        // Local development: each address is its own paper account, no email.
        await api("dev/session", { body: { subject: devSubject(address), email: address.trim() } });
        await signedIn();
        return "signed-in";
      },
      async demo() {
        await api("dev/session", { body: DEMO_TRADER });
        await signedIn();
      },
      async redeem(code) {
        await api("invites/redeem", { body: { code: code.trim() } });
        await enter();
      },
      async waitlist(email) {
        await api("waitlist", { body: { email: email.trim() } });
      },
      async signOut() {
        await api("auth/sign-out", { method: "POST" });
        rememberSignedOut(true);
        realtime?.close();
        // A full load, not a client-side push: nothing of this session may
        // stay in memory (the store, a Supabase client's timers).
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/");
      },
      prompt(reason = null, problem = null) {
        set({ authPrompt: { reason, problem } });
      },
      dismiss() {
        set({ authPrompt: null });
      },
    },
    roomMeta: (slug) => roomMeta.get(slug),

    pending(kind, id) {
      if (!id) return false;
      if (kind === "market" && markets.has(id)) return false;
      if (kind === "room" && rooms.has(id)) return false;
      const key = `${kind}:${id}`;
      return !loaded.has(key) && !failedAt.has(key);
    },
    watch(kind, id) {
      if (kind === "market") {
        marketGet(id);
        lazily(`book:${id}`, () => loadBook(id));
        lazily(`posts:market:${id}`, () => loadPosts({ market: id }));
        const stop = realtime?.watch(`market:${id}`);
        return () => stop?.();
      }
      if (kind === "room") {
        shownRooms.set(id, (shownRooms.get(id) ?? 0) + 1);
        syncRoomFeed(id);
        fire(once(`room:${id}`, () => loadRoom(id)));
        return () => {
          const n = (shownRooms.get(id) ?? 1) - 1;
          if (n > 0) shownRooms.set(id, n);
          else shownRooms.delete(id);
          syncRoomFeed(id);
        };
      }
      if (kind === "post") {
        fire(
          once(`post:${id}`, async () => {
            const dto = await api<PostDTO>(`posts/${id}`);
            await ensureMarkets([dto.marketId]);
            putPost(dto);
            changed();
          }),
        );
        const stop = realtime?.watch(`post:${id}`);
        return () => stop?.();
      }
      const key = keyOf(id);
      loadFull(key);
      lazily(`posts:trader:${key}`, () =>
        loadPosts({ trader: key === YOU ? state.settings.handle : people.handle(key) }),
      );
      return () => {};
    },
    loadThread(roomId, channel, parentId) {
      lazily(`thread:${parentId}`, async () => {
        const page = await api<MessagesDTO>(`rooms/${roomId}/channels/${channel}/messages${query({ thread: parentId })}`);
        const room = rooms.get(roomId);
        if (!room || !("items" in page)) return;
        const replies = page.items.map((m) => toMessage(people, m as Parameters<typeof toMessage>[1]));
        const known = new Set(room.messages.map((m) => m.id));
        rooms.set(roomId, { ...room, messages: [...room.messages, ...replies.filter((r) => !known.has(r.id))] });
        changed();
      });
    },

    async reset() {
      if (!state.signedIn) throw needAccount(null);
      await api("account/reset", { body: { confirm: "RESET" } });
      await Promise.all([loadPortfolio(), loadOrders(), loadActivity(), loadMe()]);
    },
    toggleWatchlist(id) {
      services.watchlists.toggleMarket("saved", id);
    },

    markets: {
      list() {
        if (catalogAt && Date.now() - catalogAt > CATALOG_FRESH_MS) {
          catalogAt = 0; // one refresh at a time; a failed one waits a minute
          queueMicrotask(() => void loadCatalog().catch(() => (catalogAt = Date.now())));
        }
        return catalog.map((id) => markets.get(id)).filter((m): m is Market => !!m);
      },
      get: marketGet,
      orderBook(id) {
        lazily(`book:${id}`, () => loadBook(id));
        return books.get(id) ?? { bids: [], asks: [] };
      },
      history(id, range) {
        const key = `history:${id}:${range}`;
        const known = histories.get(key);
        if (known && Date.now() - known.at > HISTORY_FRESH_MS) loaded.delete(key);
        lazily(key, () => loadHistory(key, id, range));
        return known?.points;
      },
      query(filters: MarketFilters) {
        const path = `markets${query({ ...filters, limit: 100 })}`;
        lazily(`query:${path}`, async () => {
          const page = await api<MarketPage>(path);
          page.items.forEach(putMarket);
          queries.set(path, page.items.map((m) => m.id));
          changed();
        });
        return queries.get(path)?.map((id) => markets.get(id)).filter((m): m is Market => !!m);
      },
      search(q: string) {
        const words = q.trim();
        if (words.length < 2) return { markets: [], traders: [], rooms: [] };
        lazily(`search:${words}`, async () => {
          const found = await api<SearchDTO>(`search${query({ q: words })}`).catch((error: unknown) => {
            searchFailed.add(words);
            changed();
            throw error;
          });
          searchFailed.delete(words);
          found.markets.forEach(putMarket);
          found.rooms.forEach(putRoom);
          searches.set(words, {
            markets: found.markets.map((m) => m.id),
            traders: found.traders.map((t) => putTrader(t)),
            rooms: found.rooms.map((r) => r.id),
          });
          changed();
        });
        const hit = searches.get(words);
        if (!hit) return searchFailed.has(words) ? null : undefined;
        return {
          markets: hit.markets.map((id) => markets.get(id)).filter((m): m is Market => !!m),
          traders: hit.traders.map((k) => traders.get(k) ?? placeholder(k)),
          rooms: hit.rooms.map((id) => rooms.get(id)).filter((r): r is Room => !!r),
        };
      },
      holders(id) {
        lazily(`holders:${id}`, async () => {
          const page = await api<{ holders: { trader: Parameters<typeof toTrader>[1]; outcome: Outcome; shares: number }[] }>(`markets/${id}/holders`);
          holders.set(id, page.holders.map((h) => ({ key: putTrader(h.trader), outcome: h.outcome, shares: h.shares })));
          changed();
        });
        return holders.get(id)?.map((h) => ({ trader: traders.get(h.key) ?? placeholder(h.key), outcome: h.outcome, shares: h.shares }));
      },
      related(id) {
        lazily(`related:${id}`, async () => {
          const page = await api<MarketPage>(`markets/${id}/related`);
          page.items.forEach(putMarket);
          related.set(id, page.items.map((m) => m.id));
          changed();
        });
        return related.get(id)?.map((m) => markets.get(m)).filter((m): m is Market => !!m);
      },
      recentTrades(id) {
        const key = `trades:${id}`;
        // The tape keeps up while it's on screen: asked again after a while.
        const at = tradesAt.get(id);
        if (at && Date.now() - at > TAPE_FRESH_MS) loaded.delete(key);
        lazily(key, async () => {
          trades.set(id, (await api<TradesDTO>(`markets/${id}/trades`)).items);
          tradesAt.set(id, Date.now());
          changed();
        });
        return trades.get(id) ?? [];
      },
      feed(kind, id) {
        if (kind === "book" ? books.has(id) : trades.has(id)) return "ready";
        return failedAt.has(`${kind}:${id}`) ? "unavailable" : "loading";
      },
    },

    profiles: {
      list: () => [...traders.values()],
      get: traderGet,
      followers: (key) => followList("followers", key),
      followingOf: (key) => followList("following", key),
      toggleFollow(key) {
        if (key === YOU) return;
        const on = !state.following.includes(key);
        fire(
          optimistic(
            () => {
              const before = { following: state.following, trader: traders.get(key) };
              state.following = toggle(state.following, key);
              const t = traders.get(key);
              if (t) traders.set(key, { ...t, followers: Math.max(0, t.followers + (on ? 1 : -1)) });
              return () => {
                state.following = before.following;
                if (before.trader) traders.set(key, before.trader);
              };
            },
            () => api(`traders/${encodeURIComponent(people.handle(key))}/follow`, { method: on ? "PUT" : "DELETE" }),
          ),
        );
      },
      toggleNotify(key) {
        if (key === YOU) return;
        const on = !state.notifyTraders.includes(key);
        fire(
          optimistic(
            () => {
              const before = { notify: state.notifyTraders, following: state.following };
              state.notifyTraders = toggle(state.notifyTraders, key);
              if (on && !state.following.includes(key)) state.following = [...state.following, key];
              return () => {
                state.notifyTraders = before.notify;
                state.following = before.following;
              };
            },
            () => api(`traders/${encodeURIComponent(people.handle(key))}/bell`, { method: on ? "PUT" : "DELETE" }),
          ),
        );
      },
    },

    orders: {
      preview(request) {
        const key = ticketKey(request);
        const cached = quotes.get(key);
        if (!cached || cached.stale) {
          const body = ticketBody(request);
          const bad = "amountCents" in body ? !(body.amountCents! > 0) : !(body.shares! > 0);
          if (bad) throw new Error(request.side === "Buy" ? "Enter an amount of at least $1.00." : "Enter a whole number of shares.");
          lazily(`quote:${key}`, async () => {
            try {
              const quote = (await api<QuoteDTO>("quotes", { body })) as unknown as Quote;
              quotes.set(key, { quote });
              latestQuote.set(ticketBase(request), quote);
            } catch (error) {
              if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) quotes.set(key, { error });
              else throw error;
            } finally {
              changed();
              // Prices move: a quote is good for a few seconds, then it's
              // asked for again. Until the new one lands the old one stays,
              // so the ticket (and its slider) never blink to "loading".
              setTimeout(() => {
                const now = quotes.get(key);
                if (now?.quote) quotes.set(key, { ...now, stale: true });
                else quotes.delete(key);
                loaded.delete(`quote:${key}`);
                changed();
              }, 8_000);
            }
          });
          if (!cached?.quote) return undefined;
        }
        if (cached.error) throw cached.error;
        return cached.quote;
      },
      latest: (request) => latestQuote.get(ticketBase(request)),
      async submit(request, options) {
        if (!state.signedIn) throw needAccount("trade");
        const order = await api<OrderDTO>("orders", {
          body: {
            ...ticketBody(request),
            ...(options.expectedPriceCents !== undefined && request.type === "Market" ? { expectedPriceCents: options.expectedPriceCents } : {}),
            ...(options.postId ? { postId: options.postId } : {}),
            clientOrderId: options.clientOrderId,
          },
        });
        const mapped = toOrder(order);
        set({ orders: [mapped, ...state.orders.filter((o) => o.id !== mapped.id)] });
        void Promise.all([loadPortfolio(), loadActivity()]).catch(() => {});
        return mapped;
      },
      async cancel(id) {
        if (!state.signedIn) throw needAccount(null);
        await optimistic(
          () => {
            const before = state.orders;
            state.orders = state.orders.map((o) => (o.id === id ? { ...o, status: "cancelled" as const } : o));
            return () => {
              state.orders = before;
            };
          },
          () => api(`orders/${id}/cancel`, { method: "POST" }),
          () => void Promise.all([loadPortfolio(), loadOrders(), loadActivity()]).catch(() => {}),
        );
      },
    },

    portfolio: {
      claim(positionId) {
        return optimistic(
          () => undefined,
          () => api<ClaimReceipt>(`positions/${positionId}/claim`, { method: "POST" }),
          () => void Promise.all([loadPortfolio(), loadActivity(), loadMe()]).catch(() => {}),
        );
      },
    },

    social: {
      toggleLike(id) {
        const on = !state.liked.includes(id);
        fire(
          optimistic(
            () => {
              const before = { liked: state.liked, post: posts.get(id) };
              state.liked = toggle(state.liked, id);
              const p = posts.get(id);
              if (p) posts.set(id, { ...p, likes: Math.max(0, p.likes + (on ? 1 : -1)) });
              return () => {
                state.liked = before.liked;
                if (before.post) posts.set(id, before.post);
              };
            },
            () => api(`posts/${id}/reactions/like`, { method: on ? "PUT" : "DELETE" }),
          ),
        );
      },
      async report(subject, reason, note) {
        if (!state.signedIn) throw needAccount(null);
        const subjectId =
          subject.type === "user"
            ? people.id(subject.id)
            : subject.type === "room"
              ? roomMeta.get(subject.id)?.realtime.replace(/^room:/, "")
              : subject.id;
        if (!subjectId) throw new ApiRequestError(404, "not_found", "That can’t be reported right now. Refresh and try again.");
        await api("reports", { body: { subjectType: subject.type, subjectId, reason, ...(note && { note }) } });
      },
      toggleBookmark(id) {
        const on = !state.bookmarked.includes(id);
        fire(
          optimistic(
            () => {
              const before = state.bookmarked;
              state.bookmarked = toggle(state.bookmarked, id);
              return () => {
                state.bookmarked = before;
              };
            },
            () => api(`posts/${id}/reactions/bookmark`, { method: on ? "PUT" : "DELETE" }),
          ),
        );
      },
      async createPost(draft: PostDraft) {
        if (!state.signedIn) throw needAccount("post");
        const dto = await api<PostDTO>("posts", {
          body: {
            market: draft.marketId,
            outcome: draft.outcome,
            text: draft.text,
            confidence: draft.confidence,
            disclosePosition: draft.disclosePosition,
            audience: draft.audience,
            clientId: newId().replace(/-/g, ""),
          },
        });
        await ensureMarkets([dto.marketId]);
        putPost(dto);
        changed();
        return posts.get(dto.id)!;
      },
      comment(postId, text, parentId) {
        const temp = `pending-${newId()}`;
        fire(
          optimistic(
            () => {
              const p = posts.get(postId);
              if (!p) return;
              posts.set(postId, { ...p, comments: [...p.comments, { id: temp, authorId: YOU, text, at: at(), ...(parentId ? { parentId } : {}), likes: 0 }] });
              return () => {
                const q = posts.get(postId);
                if (q) posts.set(postId, { ...q, comments: q.comments.filter((c) => c.id !== temp) });
              };
            },
            () =>
              api<Parameters<typeof toComment>[1]>(`posts/${postId}/comments`, {
                body: { text, ...(parentId ? { parentId } : {}), clientId: temp.replace(/-/g, "").slice(0, 60) },
              }),
            (dto) => {
              const p = posts.get(postId);
              if (p) posts.set(postId, { ...p, comments: p.comments.map((c) => (c.id === temp ? toComment(people, dto) : c)) });
            },
          ),
        );
      },
      roomMessage(roomId, text, channel, marketId, parentId) {
        const room = rooms.get(roomId);
        const target = channel ?? room?.channels.find((c) => c.id !== "predictions")?.id ?? "general";
        const temp = `pending-${newId()}`;
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, {
                ...r,
                messages: [...r.messages, { id: temp, authorId: YOU, text, at: at(), channel: target, ...(marketId ? { marketId } : {}), ...(parentId ? { parentId } : {}) }],
              });
              return () => {
                const q = rooms.get(roomId);
                if (q) rooms.set(roomId, { ...q, messages: q.messages.filter((m) => m.id !== temp) });
              };
            },
            () =>
              api<Parameters<typeof toMessage>[1]>(`rooms/${roomId}/channels/${target}/messages`, {
                body: { text, ...(marketId ? { market: marketId } : {}), ...(parentId ? { parentId } : {}), clientId: temp.replace(/-/g, "").slice(0, 60) },
              }),
            (dto) => {
              const r = rooms.get(roomId);
              if (!r) return;
              const real = toMessage(people, dto);
              // Realtime may have delivered it already.
              const messages = r.messages.filter((m) => m.id !== real.id).map((m) => (m.id === temp ? real : m));
              rooms.set(roomId, { ...r, messages });
            },
          ),
        );
      },
      markChannelRead(roomId, channel) {
        if (!state.signedIn) return;
        const key = `${roomId}/${channel}`;
        fire(
          editRoom(
            roomId,
            () => {
              const before = state.channelReads;
              state.channelReads = { ...state.channelReads, [key]: at() };
              return () => {
                state.channelReads = before;
              };
            },
            () => api(`rooms/${roomId}/channels/${channel}/read`, { method: "POST" }),
          ),
        );
      },
      toggleRoomMarket(roomId, marketId) {
        const room = rooms.get(roomId);
        const on = !room?.watchlist.includes(marketId);
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, { ...r, watchlist: toggle(r.watchlist, marketId) });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO>(`rooms/${roomId}/markets/${marketId}`, { method: on ? "PUT" : "DELETE" }),
            (dto) => putRoom(dto),
          ),
        );
      },
      joinRoom(roomId) {
        const member = rooms.get(roomId)?.members.includes(YOU);
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, {
                ...r,
                members: member ? r.members.filter((m) => m !== YOU) : [...r.members, YOU],
                memberCount: Math.max(0, r.memberCount + (member ? -1 : 1)),
              });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO | { left: true }>(`rooms/${roomId}/join`, { method: member ? "DELETE" : "PUT" }),
            (dto) => {
              if ("id" in dto) putRoom(dto);
              fire(once(`room-reload:${roomId}:${Date.now()}`, () => loadRoom(roomId)));
            },
          ),
        );
      },
      requestJoin(roomId) {
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, { ...r, requests: [...new Set([...r.requests, YOU])] });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO>(`rooms/${roomId}/requests`, { method: "POST" }),
            (dto) => putRoom(dto),
          ),
        );
      },
      answerRequest(roomId, key, approve) {
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, { ...r, requests: r.requests.filter((x) => x !== key), members: approve ? [...r.members, key] : r.members });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO>(`rooms/${roomId}/requests/${encodeURIComponent(people.handle(key))}`, { body: { approve } }),
            (dto) => putRoom(dto),
          ),
        );
      },
      setRole(roomId, key, role: RoomRole) {
        if (role === "Owner") return report(new ApiRequestError(422, "invalid", "A room has one owner."));
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, {
                ...r,
                moderators: role === "Moderator" ? [...new Set([...r.moderators, key])] : r.moderators.filter((m) => m !== key),
              });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO>(`rooms/${roomId}/members/${encodeURIComponent(people.handle(key))}`, { method: "PATCH", body: { role } }),
            (dto) => putRoom(dto),
          ),
        );
      },
      removeMember(roomId, key) {
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, { ...r, members: r.members.filter((m) => m !== key), moderators: r.moderators.filter((m) => m !== key) });
              return () => rooms.set(roomId, r);
            },
            () => api<RoomDTO>(`rooms/${roomId}/members/${encodeURIComponent(people.handle(key))}`, { method: "DELETE" }),
            (dto) => putRoom(dto),
          ),
        );
      },
      updateRoom(roomId, patch: RoomPatch) {
        const { notify, ...rest } = patch;
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              if (!r) return;
              rooms.set(roomId, { ...r, ...patch });
              return () => rooms.set(roomId, r);
            },
            async () => {
              let latest: RoomDTO | undefined;
              if (Object.keys(rest).length) latest = await api<RoomDTO>(`rooms/${roomId}`, { method: "PATCH", body: rest });
              if (notify) latest = await api<RoomDTO>(`rooms/${roomId}/notify`, { method: "PUT", body: { notify } });
              return latest;
            },
            (dto) => dto && putRoom(dto),
          ),
        );
      },
      archiveRoom(roomId) {
        fire(
          editRoom(
            roomId,
            () => {
              const r = rooms.get(roomId);
              rooms.delete(roomId);
              return () => {
                if (r) rooms.set(roomId, r);
              };
            },
            () => api(`rooms/${roomId}/archive`, { method: "POST" }),
          ),
        );
      },
      async createRoom(draft: RoomDraft) {
        if (!state.signedIn) throw needAccount(null);
        const dto = await api<RoomDTO>("rooms", {
          body: {
            name: draft.name,
            description: draft.description,
            privacy: draft.privacy,
            watchlist: draft.watchlist,
            ...(draft.disclosure !== undefined ? { disclosure: draft.disclosure } : {}),
          },
        });
        putRoom(dto);
        changed();
        fire(once(`room:${dto.id}`, () => loadRoom(dto.id)));
        return dto.id;
      },
      async addRoomMarkets(roomId, ids) {
        if (!state.signedIn) throw needAccount(null);
        touchRoom(roomId);
        try {
          const { added, room } = await api<{ added: number; room: RoomDTO }>(`rooms/${roomId}/markets`, { body: { markets: ids } });
          putRoom(room);
          changed();
          return added;
        } finally {
          touchRoom(roomId);
        }
      },
    },

    watchlists: {
      async create(name, marketId) {
        if (!state.signedIn) throw needAccount(null);
        const list = await api<WatchlistsDTO["items"][number]>("watchlists", { body: { name, ...(marketId ? { market: marketId } : {}) } });
        set({ watchlists: [...state.watchlists, { id: list.id, name: list.name, marketIds: list.marketIds, updatedAt: list.updatedAt }] });
        return list.id;
      },
      rename(id, name) {
        fire(
          optimistic(
            () => {
              const before = state.watchlists;
              state.watchlists = state.watchlists.map((w) => (w.id === id ? { ...w, name } : w));
              return () => {
                state.watchlists = before;
              };
            },
            () => api(`watchlists/${id}`, { method: "PATCH", body: { name } }),
          ),
        );
      },
      remove(id) {
        fire(
          optimistic(
            () => {
              const before = state.watchlists;
              state.watchlists = state.watchlists.filter((w) => w.id !== id);
              return () => {
                state.watchlists = before;
              };
            },
            () => api(`watchlists/${id}`, { method: "DELETE" }),
          ),
        );
      },
      toggleMarket(listId, marketId) {
        const saved = listId === "saved";
        const current = saved ? state.watchlist : (state.watchlists.find((w) => w.id === listId)?.marketIds ?? []);
        const on = !current.includes(marketId);
        fire(
          optimistic(
            () => {
              const before = { watchlist: state.watchlist, watchlists: state.watchlists };
              if (saved) state.watchlist = toggle(state.watchlist, marketId);
              else
                state.watchlists = state.watchlists.map((w) =>
                  w.id === listId ? { ...w, marketIds: toggle(w.marketIds, marketId), updatedAt: at() } : w,
                );
              return () => {
                state.watchlist = before.watchlist;
                state.watchlists = before.watchlists;
              };
            },
            () => api(`watchlists/${listId}/markets/${marketId}`, { method: on ? "PUT" : "DELETE" }),
          ),
        );
      },
      place(listId, marketId, index) {
        const saved = listId === "saved";
        const move = (ids: string[]) => {
          const rest = ids.filter((x) => x !== marketId);
          rest.splice(Math.max(0, Math.min(index, rest.length)), 0, marketId);
          return rest;
        };
        fire(
          optimistic(
            () => {
              const before = { watchlist: state.watchlist, watchlists: state.watchlists };
              if (saved) state.watchlist = move(state.watchlist);
              else state.watchlists = state.watchlists.map((w) => (w.id === listId ? { ...w, marketIds: move(w.marketIds), updatedAt: at() } : w));
              return () => {
                state.watchlist = before.watchlist;
                state.watchlists = before.watchlists;
              };
            },
            () => api(`watchlists/${listId}/markets/${marketId}`, { method: "PUT", body: { index } }),
          ),
        );
      },
    },

    notifications: {
      markRead(id) {
        if (state.readNotifications.includes(id)) return;
        fire(
          optimistic(
            () => {
              const before = state.readNotifications;
              state.readNotifications = [...state.readNotifications, id];
              return () => {
                state.readNotifications = before;
              };
            },
            () => api("notifications/read", { body: { ids: [id] } }),
          ),
        );
      },
      markAllRead() {
        fire(
          optimistic(
            () => {
              const before = state.readNotifications;
              state.readNotifications = state.notifications.map((n) => n.id);
              return () => {
                state.readNotifications = before;
              };
            },
            () => api("notifications/read", { body: { all: true } }),
          ),
        );
      },
    },

    settings: {
      update(patch) {
        fire(services.settings.save(patch));
      },
      save(patch) {
        const { email, notifications: _prefs, alerts: _alerts, ...profile } = patch;
        void _prefs;
        void _alerts;
        const previousEmail = state.settings.email;
        return (
          optimistic(
            () => {
              const before = state.settings;
              state.settings = { ...state.settings, ...patch };
              return () => {
                state.settings = before;
              };
            },
            async () => {
              const body = Object.fromEntries(
                Object.entries(profile).filter(([key]) =>
                  [
                    "displayName",
                    "handle",
                    "bio",
                    "region",
                    "theme",
                    "priceInCents",
                    "showPositionsOnPosts",
                    "appearOnLeaderboard",
                    "privateOpenPositions",
                    "interests",
                    "onboarded",
                  ].includes(key),
                ),
              );
              if (Object.keys(body).length) await api("me", { method: "PATCH", body });
              if (email !== undefined && email.trim() && email.trim() !== previousEmail) {
                await api("me/email", { body: { email: email.trim() } });
                // Switched now, confirmed once they follow the link we mailed.
                set({ account: { ...state.account, emailVerified: false } });
              }
            },
            () => {
              if (patch.handle) {
                const id = people.id(YOU);
                if (id) people.setViewer(id, patch.handle);
              }
            },
          )
        ).then(() => undefined);
      },
      async uploadAvatar(file) {
        if (!state.signedIn) throw needAccount(null);
        const { key, upload } = await api<{ key: string; upload: { url: string; fields?: Record<string, string> } }>(
          "uploads",
          { body: { purpose: "avatar", contentType: file.type, bytes: file.size } },
        );
        // Straight to storage: the API never carries the bytes.
        const sent = await fetch(upload.url, {
          method: upload.fields?.method ?? "PUT",
          headers: { "content-type": file.type },
          body: await file.arrayBuffer(),
          credentials: "same-origin",
        }).catch(() => null);
        if (!sent?.ok) throw new ApiRequestError(sent?.status ?? 0, "upload_failed", "The photo didn't upload. Try again.");
        showAvatar((await api<MeDTO>("me", { method: "PATCH", body: { avatarKey: key } })).user.avatarUrl);
      },
      async chooseAvatar(preset) {
        if (!state.signedIn) throw needAccount(null);
        showAvatar((await api<MeDTO>("me", { method: "PATCH", body: { avatarPreset: preset } })).user.avatarUrl);
      },
      async removeAvatar() {
        if (!state.signedIn) throw needAccount(null);
        showAvatar((await api<MeDTO>("me", { method: "PATCH", body: { avatarKey: null } })).user.avatarUrl);
      },
      toggleNotification(id, channel) {
        const pref = state.settings.notifications.find((p) => p.id === id);
        if (!pref || (pref.locked && channel === "app")) return;
        const value = !pref[channel];
        fire(
          optimistic(
            () => {
              const before = state.settings;
              state.settings = {
                ...state.settings,
                notifications: state.settings.notifications.map((p) => (p.id === id ? { ...p, [channel]: value } : p)),
              };
              return () => {
                state.settings = before;
              };
            },
            () => api(`me/notification-preferences/${id}`, { method: "PATCH", body: { [channel]: value } }),
          ),
        );
      },
      addAlert(alert) {
        const temp = `pending-${newId()}`;
        fire(
          optimistic(
            () => {
              const before = state.settings;
              state.settings = { ...state.settings, alerts: [...state.settings.alerts, { ...alert, id: temp }] };
              return () => {
                state.settings = before;
              };
            },
            () =>
              api<AlertsDTO["items"][number]>("alerts", {
                body: { market: alert.marketId, outcome: alert.outcome, thresholdCents: alert.thresholdCents, direction: alert.direction },
              }),
            (created) => {
              state.settings = {
                ...state.settings,
                alerts: state.settings.alerts.map((a) => (a.id === temp ? { ...a, id: created.id } : a)),
              };
            },
          ),
        );
      },
      removeAlert(id) {
        fire(
          optimistic(
            () => {
              const before = state.settings;
              state.settings = { ...state.settings, alerts: state.settings.alerts.filter((a) => a.id !== id) };
              return () => {
                state.settings = before;
              };
            },
            () => api(`alerts/${id}`, { method: "DELETE" }),
          ),
        );
      },
    },
  };
  return services;
}

export type { Outcome, Side, Order };
