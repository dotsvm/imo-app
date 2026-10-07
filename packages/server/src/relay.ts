/**
 * What happens after a change commits. The outbox relay hands each event to
 * the handlers here: realtime pushes, notifications, settlement, cleanup.
 * Handlers may see an event twice (at-least-once), so each is idempotent:
 * notifications dedupe, jobs are keyed, cancels check state first, and a
 * repeated realtime push only tells a client something it already knows.
 */
import { and, eq, sql } from "drizzle-orm";
import { channels, type DomainEvent } from "@imo/core/ports/platform";
import type { Deps } from "./composition";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { signedUsd, usd } from "./dto/format";
import type { EventHandler } from "./outbox";
import { notify, toNotificationDTO, type NotificationInput } from "./usecases/notifications";
import { unsubscribeUrl } from "./usecases/digest";
import { messageForBroadcast } from "./usecases/rooms";
import { cancelRestingInMarket } from "./usecases/trading";

export type RelayDeps = Pick<Deps, "realtime" | "jobs" | "clock" | "log" | "analytics" | "config" | "profile"> & {
  db: Db;
};

interface OrderEvent {
  orderId: string;
  userId: string;
  market?: string;
  marketId?: string;
  side?: "buy" | "sell";
  outcome?: string;
  filled?: number;
  totalFilled?: number;
  quantity?: number;
  averagePriceCents?: number | null;
  totalCents?: number;
  limitCents?: number | null;
  maker?: boolean;
  reason?: string;
  system?: boolean;
}

interface SettledEvent {
  accountId: string;
  marketId: string;
  outcome: string;
  result: string;
  shares: number;
  basis: number;
  payout: number;
}

const ORDER_STATES = ["pending", "filled", "partial", "failed", "cancelled"] as const;
const outcomeName = (key?: string) => (key === "no" ? "No" : "Yes");
const money = (cents: number) => usd(cents * 10_000);

async function marketBy(db: Db, where: { slug?: string; id?: string }) {
  const [row] = await db
    .select({ id: t.markets.id, slug: t.markets.slug, title: t.markets.shortTitle })
    .from(t.markets)
    .where(where.id ? eq(t.markets.id, where.id) : eq(t.markets.slug, where.slug ?? ""));
  return row;
}

/**
 * A notification, delivered everywhere it should go: in the app (unless
 * turned off), live to open tabs, and by email when the person asked for this
 * kind by email and has a verified address.
 */
export async function deliver(deps: RelayDeps, input: NotificationInput) {
  const row = await notify(deps.db, input);
  if (!row) return null;
  await deps.realtime.publish(channels.user(input.userId), "notification", toNotificationDTO(row));
  const [target] = await deps.db
    .select({ email: t.userSettings.email, verified: t.userSettings.emailVerifiedAt, wants: t.notificationPrefs.email })
    .from(t.userSettings)
    .leftJoin(
      t.notificationPrefs,
      and(eq(t.notificationPrefs.userId, t.userSettings.userId), eq(t.notificationPrefs.kind, input.preference)),
    )
    .where(eq(t.userSettings.userId, input.userId));
  if (target?.email && target.verified && target.wants)
    await deps.jobs.enqueue(
      "mail.send",
      {
        template: "notification",
        to: target.email,
        data: { title: row.title, body: row.body, href: row.href, cta: row.cta },
        idempotencyKey: `notification:${row.id}`,
        unsubscribeUrl: unsubscribeUrl(deps, input.userId, input.preference),
      },
      { key: `mail:${row.id}` },
    );
  return row;
}

/** The notification an order event deserves, if any. */
function orderNotice(state: (typeof ORDER_STATES)[number], p: OrderEvent, title: string) {
  const outcome = outcomeName(p.outcome);
  const at = p.averagePriceCents != null ? ` at ${p.averagePriceCents}¢` : "";
  const bought = p.side !== "sell";
  switch (state) {
    case "filled":
      return {
        icon: "filled",
        title: "Order filled",
        body: bought
          ? `${p.maker ? p.totalFilled : p.filled} ${outcome} · ${title}${at}. Total ${money(p.totalCents ?? 0)} including fees.`
          : `Sold ${p.maker ? p.totalFilled : p.filled} ${outcome} · ${title}${at}. You received ${money(p.totalCents ?? 0)} after fees.`,
        preference: "order-filled",
      };
    case "partial":
      return {
        icon: "partial",
        title: "Order partially filled",
        body: p.maker
          ? `${p.totalFilled} of ${p.quantity} ${outcome} · ${title} filled at your ${p.limitCents}¢ limit. The rest is still working.`
          : `${p.filled} ${outcome} · ${title}${at}. The rest wasn't available within 2¢ of the best price.`,
        preference: "order-filled",
      };
    case "failed":
      return {
        icon: "failed",
        title: "Order didn't fill",
        body: `${title}: no ${outcome} ${bought ? "offers" : "bids"} within 2¢ of the best price. Nothing was charged.`,
        preference: "order-failed",
      };
    case "cancelled":
      // People know when they cancel; tell them when something else did.
      return p.system
        ? {
            icon: "failed",
            title: "Order cancelled",
            body: `${title}: ${p.reason ?? "the order can no longer fill."}`,
            preference: "order-failed",
          }
        : null;
    default:
      return null;
  }
}

export function relayHandlers(deps: RelayDeps): Map<string, EventHandler[]> {
  const handlers = new Map<string, EventHandler[]>();
  const on = (type: string, handler: EventHandler) =>
    handlers.set(type, [...(handlers.get(type) ?? []), handler]);
  const { db, realtime } = deps;

  for (const state of ORDER_STATES)
    on(`order.${state}`, async (event: DomainEvent) => {
      const p = event.payload as OrderEvent;
      await realtime.publish(channels.user(p.userId), "order", {
        orderId: p.orderId,
        status: state,
        at: event.at,
      });
      const market = await marketBy(db, { slug: p.market, id: p.marketId });
      // A resting order fills in pieces: the notice totals all of them.
      if (p.maker && market) {
        const [sum] = await db
          .select({
            notional: sql<number>`coalesce(sum(${t.fills.notional}), 0)::bigint`,
            fees: sql<number>`coalesce(sum(${t.fills.feeTotal}), 0)::bigint`,
          })
          .from(t.fills)
          .where(eq(t.fills.orderId, p.orderId));
        const total = p.side === "sell" ? Number(sum.notional) - Number(sum.fees) : Number(sum.notional) + Number(sum.fees);
        p.totalCents = total / 10_000;
      }
      const notice = market && orderNotice(state, p, market.title);
      if (!notice) return;
      await deliver(deps, {
        userId: p.userId,
        kind: "Order",
        preference: notice.preference,
        icon: notice.icon,
        title: notice.title,
        body: notice.body,
        href: "/portfolio",
        dedupeKey: `order:${p.orderId}:${state}:${p.totalFilled ?? p.filled ?? 0}`,
        at: new Date(event.at),
      });
    });

  on("position.settled", async (event) => {
    const p = event.payload as SettledEvent;
    const [account] = await db
      .select({ userId: t.tradingAccounts.userId })
      .from(t.tradingAccounts)
      .where(eq(t.tradingAccounts.id, p.accountId));
    const market = await marketBy(db, { id: p.marketId });
    if (!account || !market) return;
    const outcome = outcomeName(p.outcome);
    const voided = p.result === "void";
    const headline = voided
      ? `${market.title} was voided`
      : `${market.title} resolved ${outcomeName(p.result)}`;
    const body =
      p.payout > 0
        ? `${p.shares} ${outcome} × ${voided ? "$0.50" : "$1.00"} payout. Cost basis ${usd(p.basis)} → ${p.payout >= p.basis ? "profit" : "loss"} ${signedUsd(p.payout - p.basis)} once claimed.`
        : `${p.shares} ${outcome} expired worthless. Cost basis ${usd(p.basis)} → loss ${signedUsd(-p.basis)}.`;
    await deliver(deps, {
      userId: account.userId,
      kind: "Resolution",
      preference: "resolved",
      icon: "resolved",
      title: headline,
      body,
      href: p.payout > 0 ? "/portfolio?tab=Claimable" : "/portfolio?tab=Closed",
      cta:
        p.payout > 0
          ? { label: `Claim ${usd(p.payout)}`, href: "/portfolio?tab=Claimable", primary: true }
          : undefined,
      dedupeKey: `settled:${p.marketId}:${p.outcome}`,
      at: new Date(event.at),
    });
    await realtime.publish(channels.user(account.userId), "portfolio", { reason: "settled" });
  });

  for (const type of ["claim.paid", "account.reset"])
    on(type, async (event) => {
      const { userId } = event.payload as { userId: string };
      await realtime.publish(channels.user(userId), "portfolio", { reason: type });
    });

  on("market.status", async (event) => {
    const { marketId, to } = event.payload as { marketId: string; to: string };
    const market = await marketBy(db, { id: marketId });
    if (!market) return;
    await realtime.publish(channels.market(market.slug), "status", { status: to, at: event.at });
    // Paused markets keep their resting orders; anything else can't fill.
    if (to !== "open" && to !== "paused")
      await cancelRestingInMarket(
        db,
        marketId,
        to === "closed" ? "The market closed before your limit was reached." : "The market is no longer trading.",
        deps.clock.now(),
      );
  });

  on("market.resolved", async (event) => {
    const { marketId, outcome } = event.payload as { marketId: string; outcome: string };
    await deps.jobs.enqueue("markets.settle", { marketId }, { key: `settle:${marketId}` });
    const market = await marketBy(db, { id: marketId });
    if (market)
      await realtime.publish(channels.market(market.slug), "resolved", { outcome, at: event.at });
  });

  // ------------------------------------------------------------- social
  const person = async (id: string) => {
    const [row] = await db
      .select({ id: t.users.id, handle: t.users.handle, name: t.users.displayName, bio: t.users.bio, focus: t.users.focus })
      .from(t.users)
      .where(eq(t.users.id, id));
    return row;
  };
  const snippet = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

  on("follow.created", async (event) => {
    const { followerId, followeeId } = event.payload as { followerId: string; followeeId: string };
    const follower = await person(followerId);
    if (!follower) return;
    await deliver(deps, {
      userId: followeeId,
      kind: "Follow",
      preference: "followers",
      icon: "follow",
      title: `${follower.name} followed you`,
      body: follower.bio || follower.focus || `@${follower.handle}`,
      href: `/trader/${follower.handle}`,
      dedupeKey: `follow:${followerId}`,
      at: new Date(event.at),
    });
  });

  on("post.created", async (event) => {
    const p = event.payload as { postId: string; authorId: string; roomId: string | null; mentions: string[] };
    const [author, [post]] = await Promise.all([
      person(p.authorId),
      db.select({ text: t.posts.text, deleted: t.posts.deletedAt }).from(t.posts).where(eq(t.posts.id, p.postId)),
    ]);
    if (!author || !post || post.deleted) return;
    const href = `/post/${p.postId}`;
    // In a room, only its members hear about it.
    const audience = p.roomId
      ? sql`and exists (select 1 from room_members rm where rm.room_id = ${p.roomId} and rm.user_id = f.follower_id)`
      : sql``;
    const bells = await db.execute<{ follower_id: string }>(
      sql`select f.follower_id from follows f where f.followee_id = ${p.authorId} and f.notify ${audience}`,
    );
    for (const { follower_id } of bells)
      await deliver(deps, {
        userId: follower_id,
        kind: "Follow",
        preference: "digest",
        icon: "follow",
        title: `${author.name} posted a prediction`,
        body: snippet(post.text),
        href,
        dedupeKey: `post:${p.postId}`,
        at: new Date(event.at),
      });
    for (const userId of p.mentions)
      await deliver(deps, {
        userId,
        kind: "Reply",
        preference: "replies",
        icon: "reply",
        title: `${author.name} mentioned you`,
        body: snippet(post.text),
        href,
        dedupeKey: `mention:post:${p.postId}`,
        at: new Date(event.at),
      });
    if (p.roomId) await realtime.publish(channels.room(p.roomId), "prediction", { postId: p.postId, at: event.at });
  });

  on("comment.created", async (event) => {
    const p = event.payload as {
      commentId: string;
      postId: string;
      authorId: string;
      postAuthorId: string;
      parentAuthorId: string | null;
      mentions: string[];
    };
    const [author, [comment]] = await Promise.all([
      person(p.authorId),
      db.select({ text: t.comments.text }).from(t.comments).where(eq(t.comments.id, p.commentId)),
    ]);
    if (!author || !comment) return;
    await realtime.publish(channels.post(p.postId), "comment", { commentId: p.commentId, at: event.at });
    const href = `/post/${p.postId}`;
    const told = new Set([p.authorId]);
    const tell = async (userId: string | null, title: string) => {
      if (!userId || told.has(userId)) return;
      told.add(userId);
      await deliver(deps, {
        userId,
        kind: "Reply",
        preference: "replies",
        icon: "reply",
        title,
        body: snippet(comment.text),
        href,
        dedupeKey: `comment:${p.commentId}`,
        at: new Date(event.at),
      });
    };
    await tell(p.postAuthorId, `${author.name} replied to your prediction`);
    await tell(p.parentAuthorId, `${author.name} replied to your comment`);
    for (const userId of p.mentions) await tell(userId, `${author.name} mentioned you`);
  });

  on("room.message", async (event) => {
    const p = event.payload as { roomId: string; messageId: string; authorId: string; parentId: string | null; mentions: string[] };
    const found = await messageForBroadcast(db, p.roomId, p.messageId);
    if (!found) return;
    const { room, message, view } = found;
    await realtime.publish(channels.room(room.id), "message", view);
    if (message.kind !== "message") return;
    const href = `/rooms/${room.slug}?channel=${view.channel}${message.parentId ? `&thread=${message.parentId}` : ""}`;
    const members = await db
      .select({ userId: t.roomMembers.userId, notify: t.roomMembers.notify })
      .from(t.roomMembers)
      .where(eq(t.roomMembers.roomId, room.id));
    const [parent] = message.parentId
      ? await db.select({ authorId: t.roomMessages.authorId }).from(t.roomMessages).where(eq(t.roomMessages.id, message.parentId))
      : [];
    const body = snippet(message.text || "Shared a market");
    for (const member of members) {
      if (member.userId === p.authorId || member.notify === "nothing") continue;
      const mentioned = p.mentions.includes(member.userId);
      const repliedTo = parent?.authorId === member.userId;
      if (!mentioned && !repliedTo && member.notify !== "all") continue;
      await deliver(deps, {
        userId: member.userId,
        kind: "Room",
        preference: mentioned || repliedTo ? "replies" : "rooms",
        icon: "room",
        title: mentioned
          ? `${view.author.name} mentioned you in ${room.name}`
          : repliedTo
            ? `${view.author.name} replied in your thread in ${room.name}`
            : `New message in ${room.name} · #${view.channel}`,
        body: `${view.author.name}: ${body}`,
        href,
        dedupeKey: `room-message:${message.id}`,
        at: new Date(event.at),
      });
    }
  });

  for (const [type, name] of [
    ["room.message.edited", "message.updated"],
    ["room.message.deleted", "message.deleted"],
  ] as const)
    on(type, async (event) => {
      const { roomId, messageId } = event.payload as { roomId: string; messageId: string };
      const found = await messageForBroadcast(db, roomId, messageId);
      await realtime.publish(channels.room(roomId), name, found?.view ?? { id: messageId });
    });

  on("room.joined", async (event) => {
    const { roomId, userId } = event.payload as { roomId: string; userId: string };
    await realtime.publish(channels.room(roomId), "member", { userId, joined: true, at: event.at });
  });

  const roomOf = async (id: string) => {
    const [room] = await db.select().from(t.rooms).where(eq(t.rooms.id, id));
    return room;
  };

  on("room.requested", async (event) => {
    const { roomId, userId } = event.payload as { roomId: string; userId: string };
    const [room, asker] = await Promise.all([roomOf(roomId), person(userId)]);
    if (!room || !asker) return;
    const staff = await db
      .select({ userId: t.roomMembers.userId })
      .from(t.roomMembers)
      .where(and(eq(t.roomMembers.roomId, roomId), sql`${t.roomMembers.role} in ('owner', 'moderator')`));
    for (const { userId: staffId } of staff)
      await deliver(deps, {
        userId: staffId,
        kind: "Room",
        preference: "rooms",
        icon: "room",
        title: `${asker.name} asked to join ${room.name}`,
        body: asker.bio || asker.focus || `@${asker.handle}`,
        href: `/rooms/${room.slug}?panel=requests`,
        cta: { label: "Review", href: `/rooms/${room.slug}?panel=requests`, primary: true },
        dedupeKey: `room-request:${roomId}:${userId}:${event.id}`,
        at: new Date(event.at),
      });
  });

  on("room.added", async (event) => {
    const { roomId, userId, by } = event.payload as { roomId: string; userId: string; by: string };
    const [room, adder] = await Promise.all([roomOf(roomId), person(by)]);
    if (!room || !adder) return;
    await deliver(deps, {
      userId,
      kind: "Room",
      preference: "rooms",
      icon: "room",
      title: `${adder.name} added you to ${room.name}`,
      body: room.description || "Say hello.",
      href: `/rooms/${room.slug}`,
      cta: { label: "Open room", href: `/rooms/${room.slug}`, primary: true },
      dedupeKey: `room-added:${roomId}:${userId}`,
      at: new Date(event.at),
    });
    await realtime.publish(channels.room(roomId), "member", { userId, joined: true, at: event.at });
  });

  on("room.answered", async (event) => {
    const { roomId, userId, approve } = event.payload as { roomId: string; userId: string; approve: boolean };
    const room = await roomOf(roomId);
    if (!room || !approve) return;
    await deliver(deps, {
      userId,
      kind: "Room",
      preference: "rooms",
      icon: "room",
      title: `You're in: ${room.name}`,
      body: room.description,
      href: `/rooms/${room.slug}`,
      dedupeKey: `room-approved:${roomId}:${event.id}`,
      at: new Date(event.at),
    });
  });

  on("room.market", async (event) => {
    const { roomId, marketId, by } = event.payload as { roomId: string; marketId: string; by: string };
    const [room, adder, market] = await Promise.all([roomOf(roomId), person(by), marketBy(db, { id: marketId })]);
    if (!room || !adder || !market) return;
    await realtime.publish(channels.room(roomId), "markets", { added: market.slug, at: event.at });
    const members = await db
      .select({ userId: t.roomMembers.userId })
      .from(t.roomMembers)
      .where(and(eq(t.roomMembers.roomId, roomId), sql`${t.roomMembers.notify} <> 'nothing'`));
    for (const { userId } of members) {
      if (userId === by) continue;
      await deliver(deps, {
        userId,
        kind: "Room",
        preference: "rooms",
        icon: "room",
        title: `New market in ${room.name}`,
        body: `${adder.name} added ${market.title} to the shared watchlist.`,
        href: `/rooms/${room.slug}`,
        dedupeKey: `room-market:${roomId}:${marketId}`,
        at: new Date(event.at),
      });
    }
  });

  // Product analytics: what happened, by whom — never what anyone wrote.
  const tracked: Record<string, (p: Record<string, unknown>) => [string, string, Record<string, unknown>] | null> = {
    "user.created": (p) => ["signed_up", String(p.userId), { method: p.method }],
    "post.created": (p) => ["prediction_posted", String(p.authorId), { market: p.market, room: !!p.roomId }],
    "comment.created": (p) => ["commented", String(p.authorId), {}],
    "follow.created": (p) => ["followed", String(p.followerId), {}],
    "room.message": (p) => ["room_message_sent", String(p.authorId), { thread: !!p.parentId }],
    "room.joined": (p) => ["room_joined", String(p.userId), {}],
    "claim.paid": (p) => ["payout_claimed", String(p.userId), {}],
    "account.reset": (p) => ["season_reset", String(p.userId), { season: p.season }],
    "beta.granted": (p) => ["beta_granted", String(p.userId), { invited: !!p.invitedBy }],
    ...Object.fromEntries(
      ORDER_STATES.map((state) => [
        `order.${state}`,
        (p: Record<string, unknown>) => [`order_${state}`, String(p.userId), { market: p.market, side: p.side, outcome: p.outcome, maker: !!p.maker }] as [string, string, Record<string, unknown>],
      ]),
    ),
  };
  for (const [type, describe] of Object.entries(tracked))
    on(type, async (event) => {
      const described = describe(event.payload as Record<string, unknown>);
      if (described) deps.analytics.capture(described[0], described[1], described[2]);
    });

  on("beta.granted", async (event) => {
    const { userId, invitedBy } = event.payload as { userId: string; invitedBy: string | null };
    const newcomer = await person(userId);
    if (!invitedBy || !newcomer) return;
    await deliver(deps, {
      userId: invitedBy,
      kind: "Follow",
      preference: "followers",
      icon: "follow",
      title: `${newcomer.name} joined imo with your invite`,
      body: "Say hello — or see what they back first.",
      href: `/trader/${newcomer.handle}`,
      dedupeKey: `invited:${userId}`,
      at: new Date(event.at),
    });
  });

  return handlers;
}
