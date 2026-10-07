/**
 * API answers → the shapes the screens were built on (packages/domain/src/types).
 * People are keyed the way the screens address them: the signed-in person is
 * "you", everyone else is their handle — so links read /trader/mirak.
 */
import type {
  Activity,
  ClosedPosition,
  Comment,
  Market,
  Notification,
  Order,
  Post,
  Position,
  Room,
  RoomMessage,
  Trader,
  TraderRecord,
} from "@imo/domain/types";
import type {
  CommentDTO,
  MarketDTO,
  NotificationDTO,
  OrderDTO,
  PortfolioDTO,
  PostDTO,
  RoomDTO,
  RoomSummaryDTO,
  TraderDTO,
  TraderSummaryDTO,
} from "@imo/server/dto/api-types";

export const YOU = "you";

/** Who's who: the API's ids, the screens' keys, and the handles for URLs. */
export class People {
  private keyOfId = new Map<string, string>();
  private handleOfKey = new Map<string, string>();
  private idOfKey = new Map<string, string>();
  viewerId: string | null = null;

  setViewer(id: string, handle: string) {
    this.viewerId = id;
    this.remember({ id, handle, isYou: true });
  }

  /** Learn a person from any summary; answers their key. */
  remember(p: { id: string; handle: string; isYou?: boolean }) {
    const key = p.isYou || p.id === this.viewerId ? YOU : p.handle;
    this.keyOfId.set(p.id, key);
    this.handleOfKey.set(key, p.handle);
    this.idOfKey.set(key, p.id);
    return key;
  }

  key(id: string) {
    return this.keyOfId.get(id) ?? id;
  }
  /** The handle to put in an API path for a key. */
  handle(key: string) {
    return this.handleOfKey.get(key) ?? key;
  }
  id(key: string) {
    return this.idOfKey.get(key);
  }
}

const emptyStats = () => ({
  returnPct: 0,
  correct: 0,
  resolved: 0,
  trades: 0,
  pnlCents: 0,
  startingCapitalCents: 0,
});

export const emptyRecord = (): TraderRecord => ({
  rightNotProfitable: 0,
  profitableNotRight: 0,
  winTrades: 0,
  lossTrades: 0,
  avgHoldDays: 0,
  feesCents: 0,
  maxDrawdownCents: 0,
  biggestLossCents: 0,
  biggestLossOn: "no losses yet",
  drawdownWindow: "peak to trough",
  realizedCents: 0,
  unrealizedCents: 0,
  predictions: 0,
});

/** A person from a summary; stats stay empty until their profile loads. */
export function toTrader(people: People, dto: TraderSummaryDTO, previous?: Trader): Trader {
  const id = people.remember(dto);
  return {
    id,
    name: dto.name,
    handle: dto.handle,
    initials: dto.initials,
    color: dto.color,
    bio: dto.bio,
    interests: dto.interests as Trader["interests"],
    focus: dto.focus,
    joined: dto.joined,
    venueId: previous?.venueId ?? "kalshi",
    followers: dto.followers,
    following: dto.following,
    rooms: dto.rooms,
    privatePositions: dto.privatePositions,
    ...(previous?.curve30 ? { curve30: previous.curve30 } : {}),
    ...(previous?.curves ? { curves: previous.curves } : {}),
    ...(previous?.rank30 !== undefined ? { rank30: previous.rank30 } : {}),
    record: previous?.record ?? emptyRecord(),
    stats: previous?.stats ?? { "7D": emptyStats(), "30D": emptyStats(), "90D": emptyStats(), All: emptyStats() },
    categories: previous?.categories ?? {},
    history: previous?.history ?? [],
    ...(dto.avatarUrl ? { avatarUrl: dto.avatarUrl } : {}),
  } as Trader;
}

/** A full profile: record, stats per period, history. */
export function toFullTrader(people: People, dto: TraderDTO, previous?: Trader): Trader {
  const base = toTrader(people, dto, previous);
  return {
    ...base,
    ...(dto.curve30 ? { curve30: dto.curve30 } : {}),
    curves: dto.curves,
    rank30: dto.rank30,
    record: { ...emptyRecord(), ...((dto.record ?? {}) as Partial<TraderRecord>) },
    stats: dto.stats,
    categories: dto.categories as Trader["categories"],
    history: dto.history.map((h) => ({ ...h })),
    roomIds: dto.roomIds,
  };
}

export const toMarket = (dto: MarketDTO): Market => dto as unknown as Market;

export function toComment(people: People, dto: CommentDTO): Comment {
  if (dto.author) people.remember(dto.author);
  return {
    id: dto.id,
    authorId: people.key(dto.authorId),
    text: dto.text,
    at: dto.at,
    ...("parentId" in dto && dto.parentId ? { parentId: dto.parentId } : {}),
    likes: dto.likes,
    stake: dto.stake,
  };
}

export function toPost(people: People, dto: PostDTO, previous?: Post): Post {
  people.remember(dto.author);
  return {
    id: dto.id,
    authorId: people.key(dto.authorId),
    marketId: dto.marketId,
    outcome: dto.outcome,
    entryPrice: dto.entryPrice,
    text: dto.text,
    ...("invalidation" in dto && dto.invalidation ? { invalidation: dto.invalidation } : {}),
    confidence: dto.confidence,
    disclosePosition: dto.disclosePosition,
    audience: dto.audience,
    at: dto.at,
    likes: dto.likes,
    reposts: dto.reposts,
    views: dto.views,
    backed: dto.backed,
    faded: dto.faded,
    evidenceShares: dto.evidenceShares,
    images: dto.images,
    // The post's page brings every reply; a feed, its top two. Keep the fuller set.
    comments:
      previous && previous.comments.length > dto.comments.length
        ? previous.comments
        : dto.comments.map((c) => toComment(people, c)),
    commentCount: dto.commentCount,
  };
}

export const toPosition = (p: PortfolioDTO["positions"][number]): Position => ({
  id: p.id,
  marketId: p.marketId,
  outcome: p.outcome,
  shares: p.shares,
  costCents: p.costCents,
  feeCents: p.feeCents,
  fills: p.fills,
  valueCents: p.valueCents,
});

export const toClosed = (c: PortfolioDTO["closed"][number]): ClosedPosition => ({
  id: c.id,
  marketId: c.marketId,
  outcome: c.outcome,
  shares: c.shares,
  costCents: c.costCents,
  feeCents: c.feeCents,
  proceedsCents: c.proceedsCents,
  exitFeeCents: c.exitFeeCents,
  closedAt: c.closedAt,
  fills: [],
});

export const toOrder = (o: OrderDTO): Order =>
  ({
    id: o.id,
    quote: o.quote,
    status: o.status,
    at: o.at,
    filledShares: o.filledShares,
    resting: o.resting,
    filledTotalCents: o.filledTotalCents,
    averagePriceCents: o.averagePriceCents,
    reason: o.reason,
    limitCents: o.limitCents,
    ...(o.postId ? { postId: o.postId } : {}),
  }) as Order;

export const toActivity = (a: Activity): Activity => a;

export const toNotification = (n: NotificationDTO): Notification => ({
  id: n.id,
  kind: n.kind as Notification["kind"],
  icon: n.icon as Notification["icon"],
  title: n.title,
  body: n.body,
  at: n.at,
  href: n.href,
  ...(n.cta ? { cta: n.cta } : {}),
});

const NOTIFY: Record<string, Room["notify"]> = { "All messages": "All messages", Mentions: "Mentions", Nothing: "Nothing" };

export interface RoomMeta {
  /** The API's id: realtime listens on room:<uuid>. */
  realtime: string;
  role: string | null;
  requested: boolean;
  unread: number;
  locked: boolean;
  channelUnread: Record<string, number>;
  lastRead: Record<string, string | null>;
}

/** A room from its summary (the directory) or its full page. */
export function toRoom(people: People, dto: RoomSummaryDTO | RoomDTO, previous?: Room): { room: Room; meta: RoomMeta } {
  people.remember({ id: dto.owner.id, handle: dto.owner.handle });
  const full = "locked" in dto && dto.locked === false ? (dto as Extract<RoomDTO, { locked: false }>) : undefined;
  const members = full ? full.members.map((m) => people.remember(m)) : (previous?.members ?? []);
  const room: Room = {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    symbol: dto.symbol,
    owner: people.key(dto.owner.id),
    privacy: dto.privacy,
    online: dto.online,
    memberCount: dto.memberCount,
    postsToday: dto.postsToday,
    // You belong if you have a role, whether or not the member list is loaded.
    members: dto.role && !members.includes(YOU) ? [...members, YOU] : members,
    onlineMembers: full ? full.onlineIds.map((id) => people.key(id)) : previous?.onlineMembers,
    moderators: full ? full.moderators.map((id) => people.key(id)) : (previous?.moderators ?? []),
    // Moderators see every request; anyone else sees only their own.
    requests: [
      ...(full ? full.requests.map((r) => people.remember(r)) : (previous?.requests ?? []).filter((r) => r !== YOU)),
      ...(dto.requested ? [YOU] : []),
    ],
    disclosure: full ? full.disclosure : (previous?.disclosure ?? false),
    rules: full ? full.rules : (previous?.rules ?? ""),
    notify: full?.notify ? NOTIFY[full.notify] : (previous?.notify ?? "Mentions"),
    watchlist: dto.watchlist ?? previous?.watchlist ?? [],
    channels: full ? full.channels.map((c) => ({ id: c.id, topic: c.topic, ...(c.marketId ? { marketId: c.marketId } : {}) })) : (previous?.channels ?? []),
    messages: previous?.messages ?? [],
  };
  return {
    room,
    meta: {
      realtime: dto.realtime,
      role: dto.role,
      requested: dto.requested,
      unread: dto.unread,
      locked: "locked" in dto ? dto.locked : false,
      channelUnread: full ? Object.fromEntries(full.channels.map((c) => [c.id, c.unread])) : {},
      lastRead: full ? Object.fromEntries(full.channels.map((c) => [c.id, c.lastReadAt])) : {},
    },
  };
}

type MessageDTO = {
  id: string;
  authorId: string;
  author: TraderSummaryDTO;
  text: string;
  at: string;
  channel: string;
  marketId?: string;
  parentId?: string;
  kind?: "join";
  with?: string[];
  holdings?: { outcome: "Yes" | "No"; shares: number }[];
};

export function toMessage(people: People, dto: MessageDTO): RoomMessage {
  if (dto.author) people.remember(dto.author);
  // Someone holding both sides shows the larger.
  const held = dto.holdings?.toSorted((a, b) => b.shares - a.shares)[0];
  return {
    ...(dto.holdings ? { holding: held ?? null } : {}),
    id: dto.id,
    authorId: people.key(dto.authorId),
    text: dto.text,
    at: dto.at,
    channel: dto.channel,
    ...(dto.marketId ? { marketId: dto.marketId } : {}),
    ...(dto.parentId ? { parentId: dto.parentId } : {}),
    ...(dto.kind === "join" ? { kind: "join" as const, with: (dto.with ?? []).map((id) => people.key(id)) } : {}),
  };
}
