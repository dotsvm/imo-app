/**
 * Rooms: communities around a set of markets. Members talk in channels (one
 * per catalyst), reply in threads, and — when the room turns disclosure on —
 * see each other's actual holdings on messages about a linked market.
 * Owners and moderators run the room: requests, roles, rules, channels.
 */
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { compareRanks, rankAt } from "@imo/core/rank";
import type { Deps } from "../composition";
import type { Db, Queryable, Tx } from "../db/client";
import * as t from "../db/schema";
import { ROOM_COLORS, type RoomColor } from "../catalogs";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { appendEvent } from "../outbox";
import { traderSummaries } from "./people";
import { mentionedUsers } from "./posts";
import { checkUpload } from "./uploads";
import type { Viewer } from "./viewer";

export const PREDICTIONS_CHANNEL = "predictions";
export const GENERAL_CHANNEL = "general";
const ONLINE_MS = 5 * 60_000;
const MAX_ROOM_MARKETS = 100;

type Room = typeof t.rooms.$inferSelect;
type Role = (typeof t.ROOM_ROLES)[number];
type RoomDeps = Pick<Deps, "clock">;

const ROLE_VIEW = { owner: "Owner", moderator: "Moderator", member: "Member" } as const;
const NOTIFY_VIEW = { all: "All messages", mentions: "Mentions", nothing: "Nothing" } as const;
export const NOTIFY_KEYS = { "All messages": "all", Mentions: "mentions", Nothing: "nothing" } as const;

const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "room";

async function roomBySlug(db: Queryable, slug: string) {
  const [room] = await db.select().from(t.rooms).where(eq(t.rooms.slug, slug));
  if (!room) throw notFound("That room");
  return room;
}

async function membership(db: Queryable, roomId: string, userId: string | undefined) {
  if (!userId) return undefined;
  const [row] = await db
    .select()
    .from(t.roomMembers)
    .where(and(eq(t.roomMembers.roomId, roomId), eq(t.roomMembers.userId, userId)));
  return row;
}

/** Invite-only rooms are readable by members only; public ones by anyone. */
async function readable(db: Queryable, viewer: Viewer | null, slug: string) {
  const room = await roomBySlug(db, slug);
  const member = await membership(db, room.id, viewer?.userId);
  if (room.privacy === "invite" && !member) throw forbidden("This room is invite only.");
  return { room, member };
}

async function asMember(db: Queryable, viewer: Viewer, slug: string) {
  const room = await roomBySlug(db, slug);
  const member = await membership(db, room.id, viewer.userId);
  if (!member) throw forbidden("Join the room first.");
  if (room.archivedAt) throw conflict("room_archived", "This room is archived.");
  return { room, member };
}

async function asModerator(db: Queryable, viewer: Viewer, slug: string) {
  const found = await asMember(db, viewer, slug);
  if (found.member.role === "member") throw forbidden("Only the owner and moderators can do that.");
  return found;
}

async function userIdByHandle(db: Queryable, handle: string) {
  const [user] = await db.select({ id: t.users.id }).from(t.users).where(sql`lower(${t.users.handle}) = lower(${handle})`);
  if (!user) throw notFound("That trader");
  return user.id;
}

/** Summaries for many rooms at once: counts, your role, your unread. */
async function summaries(deps: RoomDeps, db: Db, viewer: Viewer | null, rooms: Room[]) {
  if (!rooms.length) return [];
  const ids = rooms.map((r) => r.id);
  const now = deps.clock.now().getTime();
  const [owners, mine, requested, online, today, unread] = await Promise.all([
    db
      .select({ id: t.users.id, handle: t.users.handle, name: t.users.displayName })
      .from(t.users)
      .where(inArray(t.users.id, [...new Set(rooms.map((r) => r.ownerId))])),
    viewer
      ? db.select().from(t.roomMembers).where(and(eq(t.roomMembers.userId, viewer.userId), inArray(t.roomMembers.roomId, ids)))
      : Promise.resolve([]),
    viewer
      ? db.select({ roomId: t.roomRequests.roomId }).from(t.roomRequests).where(and(eq(t.roomRequests.userId, viewer.userId), inArray(t.roomRequests.roomId, ids)))
      : Promise.resolve([]),
    db
      .select({ roomId: t.roomMembers.roomId, n: count() })
      .from(t.roomMembers)
      .where(and(inArray(t.roomMembers.roomId, ids), gt(t.roomMembers.lastSeenAt, new Date(now - ONLINE_MS))))
      .groupBy(t.roomMembers.roomId),
    db
      .select({ roomId: t.roomMessages.roomId, n: count() })
      .from(t.roomMessages)
      .where(and(inArray(t.roomMessages.roomId, ids), gt(t.roomMessages.createdAt, new Date(now - 86_400_000)), isNull(t.roomMessages.deletedAt), eq(t.roomMessages.kind, "message")))
      .groupBy(t.roomMessages.roomId),
    viewer
      ? db
          .select({ roomId: t.roomMessages.roomId, n: count() })
          .from(t.roomMessages)
          .innerJoin(t.roomMembers, and(eq(t.roomMembers.roomId, t.roomMessages.roomId), eq(t.roomMembers.userId, viewer.userId)))
          .leftJoin(t.channelReads, and(eq(t.channelReads.channelId, t.roomMessages.channelId), eq(t.channelReads.userId, viewer.userId)))
          .where(
            and(
              inArray(t.roomMessages.roomId, ids),
              isNull(t.roomMessages.deletedAt),
              isNull(t.roomMessages.parentId),
              ne(t.roomMessages.authorId, viewer.userId),
              sql`${t.roomMessages.createdAt} > coalesce(${t.channelReads.lastReadAt}, ${t.roomMembers.joinedAt})`,
            ),
          )
          .groupBy(t.roomMessages.roomId)
      : Promise.resolve([]),
  ]);
  // Each room's shared market list, in its order.
  const lists = await db
    .select({ roomId: t.roomMarkets.roomId, slug: t.markets.slug, rank: t.roomMarkets.rank })
    .from(t.roomMarkets)
    .innerJoin(t.markets, eq(t.markets.id, t.roomMarkets.marketId))
    .where(inArray(t.roomMarkets.roomId, ids));
  const ownerOf = new Map(owners.map((o) => [o.id, o]));
  const memberOf = new Map(mine.map((m) => [m.roomId, m]));
  const n = (rows: { roomId: string; n: number }[], id: string) => rows.find((r) => r.roomId === id)?.n ?? 0;
  return rooms.map((room) => {
    const member = memberOf.get(room.id);
    return {
      id: room.slug,
      name: room.name,
      description: room.description,
      symbol: room.symbol,
      /** The badge colour behind the symbol (hex). */
      color: ROOM_COLORS[room.color as RoomColor] ?? ROOM_COLORS[colorFor(room.name)],
      avatarUrl: room.avatarUrl,
      topics: room.topics,
      owner: ownerOf.get(room.ownerId)!,
      privacy: room.privacy === "public" ? ("Public" as const) : ("Invite only" as const),
      memberCount: room.memberCount,
      online: n(online, room.id),
      postsToday: n(today, room.id),
      role: member ? ROLE_VIEW[member.role] : null,
      requested: requested.some((r) => r.roomId === room.id),
      unread: member ? n(unread, room.id) : 0,
      archived: !!room.archivedAt,
      watchlist: lists
        .filter((l) => l.roomId === room.id)
        .sort((a, b) => compareRanks(a.rank, b.rank))
        .map((l) => l.slug),
      /** The realtime channel to listen on for this room. */
      realtime: `room:${room.id}`,
    };
  });
}

export async function listRooms(
  deps: RoomDeps,
  db: Db,
  viewer: Viewer | null,
  query: { mine?: boolean; q?: string; limit?: number },
) {
  const limit = Math.min(query.limit ?? 30, 100);
  const rooms = await db
    .select()
    .from(t.rooms)
    .where(
      and(
        isNull(t.rooms.archivedAt),
        query.mine && viewer
          ? sql`${t.rooms.id} in (select room_id from room_members where user_id = ${viewer.userId})`
          : undefined,
        query.q ? ilike(t.rooms.name, `%${query.q.replace(/[%_]/g, "")}%`) : undefined,
      ),
    )
    .orderBy(desc(t.rooms.memberCount), asc(t.rooms.createdAt))
    .limit(limit);
  return { items: await summaries(deps, db, viewer, rooms) };
}

export async function getRoom(deps: RoomDeps, db: Db, viewer: Viewer | null, slug: string) {
  const room = await roomBySlug(db, slug);
  const member = await membership(db, room.id, viewer?.userId);
  const [summary] = await summaries(deps, db, viewer, [room]);
  // An invite-only room shows outsiders its cover, and a way to ask in.
  if (room.privacy === "invite" && !member) return { ...summary, locked: true as const };
  const [channels, reads, members, requests, markets] = await Promise.all([
    db
      .select({ channel: t.channels, market: t.markets.slug })
      .from(t.channels)
      .leftJoin(t.markets, eq(t.markets.id, t.channels.marketId))
      .where(eq(t.channels.roomId, room.id))
      .orderBy(asc(t.channels.position), asc(t.channels.slug)),
    viewer
      ? db
          .select({ channelId: t.channelReads.channelId, at: t.channelReads.lastReadAt })
          .from(t.channelReads)
          .innerJoin(t.channels, eq(t.channels.id, t.channelReads.channelId))
          .where(and(eq(t.channelReads.userId, viewer.userId), eq(t.channels.roomId, room.id)))
      : Promise.resolve([]),
    db
      .select({ user: t.users, role: t.roomMembers.role, lastSeenAt: t.roomMembers.lastSeenAt })
      .from(t.roomMembers)
      .innerJoin(t.users, eq(t.users.id, t.roomMembers.userId))
      .where(eq(t.roomMembers.roomId, room.id))
      .orderBy(sql`case ${t.roomMembers.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`, asc(t.roomMembers.joinedAt))
      .limit(100),
    member && member.role !== "member"
      ? db
          .select({ user: t.users })
          .from(t.roomRequests)
          .innerJoin(t.users, eq(t.users.id, t.roomRequests.userId))
          .where(eq(t.roomRequests.roomId, room.id))
          .orderBy(asc(t.roomRequests.createdAt))
      : Promise.resolve([]),
    db
      .select({ slug: t.markets.slug, rank: t.roomMarkets.rank })
      .from(t.roomMarkets)
      .innerJoin(t.markets, eq(t.markets.id, t.roomMarkets.marketId))
      .where(eq(t.roomMarkets.roomId, room.id)),
  ]);
  const readAt = new Map(reads.map((r) => [r.channelId, r.at]));
  const unreadRows = member
    ? await db
        .select({ channelId: t.roomMessages.channelId, n: count() })
        .from(t.roomMessages)
        .leftJoin(t.channelReads, and(eq(t.channelReads.channelId, t.roomMessages.channelId), eq(t.channelReads.userId, member.userId)))
        .where(
          and(
            eq(t.roomMessages.roomId, room.id),
            isNull(t.roomMessages.deletedAt),
            isNull(t.roomMessages.parentId),
            ne(t.roomMessages.authorId, member.userId),
            sql`${t.roomMessages.createdAt} > coalesce(${t.channelReads.lastReadAt}, ${member.joinedAt.toISOString()}::timestamptz)`,
          ),
        )
        .groupBy(t.roomMessages.channelId)
    : [];
  const people = await traderSummaries(db, viewer, members.map((m) => m.user));
  return {
    ...summary,
    locked: false as const,
    rules: room.rules,
    disclosure: room.disclosure,
    notify: member ? NOTIFY_VIEW[member.notify] : null,
    watchlist: markets.sort((a, b) => compareRanks(a.rank, b.rank)).map((m) => m.slug),
    channels: channels.map(({ channel, market }) => ({
      id: channel.slug,
      topic: channel.topic,
      ...(market ? { marketId: market } : {}),
      unread: unreadRows.find((u) => u.channelId === channel.id)?.n ?? 0,
      lastReadAt: readAt.get(channel.id)?.toISOString() ?? null,
    })),
    members: people,
    /** Members seen in the room in the last few minutes. */
    onlineIds: members
      .filter((m) => m.lastSeenAt && deps.clock.now().getTime() - m.lastSeenAt.getTime() < ONLINE_MS)
      .map((m) => m.user.id),
    moderators: members.filter((m) => m.role === "moderator").map((m) => m.user.id),
    ownerId: room.ownerId,
    requests: requests.length ? await traderSummaries(db, viewer, requests.map((r) => r.user)) : [],
  };
}

async function uniqueRoomSlug(db: Queryable, name: string) {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.floor(100 + Math.random() * 900)}`;
    const [taken] = await db.select({ id: t.rooms.id }).from(t.rooms).where(eq(t.rooms.slug, candidate));
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const symbolOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "R";

export interface RoomDraft {
  name: string;
  description: string;
  privacy: "Public" | "Invite only";
  watchlist: string[];
  disclosure?: boolean;
  rules?: string;
  color?: RoomColor;
  avatarKey?: string;
  topics?: string[];
  /** Handles of people to add as members right away. */
  invite?: string[];
}

/** A colour for a room that didn't pick one, steady for its name. */
const colorFor = (name: string): RoomColor => {
  const keys = Object.keys(ROOM_COLORS) as RoomColor[];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return keys[h % keys.length]!;
};

/** Tags, tidied: trimmed, one of each (case-insensitively), at most six. */
const tidyTopics = (topics: string[] = []) => {
  const seen = new Set<string>();
  return topics
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 6);
};

export async function createRoom(deps: RoomDeps & Pick<Deps, "storage">, db: Db, viewer: Viewer, draft: RoomDraft) {
  // A picture must be this person's own upload, and really an image.
  const avatarUrl = draft.avatarKey
    ? (await checkUpload(deps, viewer, "room", draft.avatarKey), deps.storage.publicUrl(draft.avatarKey))
    : null;
  const slug = await db.transaction(async (tx) => {
    const [{ owned }] = await tx
      .select({ owned: count() })
      .from(t.rooms)
      .where(and(eq(t.rooms.ownerId, viewer.userId), isNull(t.rooms.archivedAt)));
    if (owned >= 10) throw invalid("You can run up to 10 rooms.");
    const slug = await uniqueRoomSlug(tx, draft.name);
    const [room] = await tx
      .insert(t.rooms)
      .values({
        slug,
        name: draft.name,
        description: draft.description,
        symbol: symbolOf(draft.name),
        color: draft.color ?? colorFor(draft.name),
        avatarUrl,
        topics: tidyTopics(draft.topics),
        ownerId: viewer.userId,
        privacy: draft.privacy === "Public" ? "public" : "invite",
        disclosure: draft.disclosure ?? false,
        rules: draft.rules ?? "",
        memberCount: 1,
        createdAt: deps.clock.now(),
      })
      .returning();
    await tx
      .insert(t.roomMembers)
      .values({ roomId: room.id, userId: viewer.userId, role: "owner", notify: "all", joinedAt: deps.clock.now(), lastSeenAt: deps.clock.now() });
    await tx.insert(t.channels).values([
      { roomId: room.id, slug: GENERAL_CHANNEL, topic: draft.description.slice(0, 120) || "Anything goes. Sources over vibes.", position: 0 },
      { roomId: room.id, slug: PREDICTIONS_CHANNEL, topic: "Predictions posted about the room’s markets", position: 1 },
    ]);
    await addMarkets(tx, room, viewer, draft.watchlist);
    // People added at creation join straight away, and hear about it.
    const handles = [...new Set((draft.invite ?? []).map((h) => h.toLowerCase()))];
    if (handles.length) {
      const people = await tx
        .select({ id: t.users.id })
        .from(t.users)
        .where(and(sql`lower(${t.users.handle}) in ${handles}`, isNull(t.users.deletedAt), ne(t.users.id, viewer.userId)));
      if (people.length) {
        const now = deps.clock.now();
        await tx
          .insert(t.roomMembers)
          .values(people.map((p) => ({ roomId: room.id, userId: p.id, role: "member" as const, notify: "mentions" as const, joinedAt: now, lastSeenAt: now })))
          .onConflictDoNothing();
        await tx.update(t.rooms).set({ memberCount: 1 + people.length }).where(eq(t.rooms.id, room.id));
        for (const p of people)
          await appendEvent(tx, "room.added", `room:${room.id}`, { roomId: room.id, userId: p.id, by: viewer.userId });
      }
    }
    return slug;
  });
  return getRoom(deps, db, viewer, slug);
}

export async function updateRoom(
  deps: RoomDeps,
  db: Db,
  viewer: Viewer,
  slug: string,
  patch: { name?: string; description?: string; rules?: string; disclosure?: boolean; privacy?: "Public" | "Invite only" },
) {
  const { room, member } = await asModerator(db, viewer, slug);
  if ((patch.privacy !== undefined || patch.name !== undefined) && member.role !== "owner")
    throw forbidden("Only the owner can rename the room or change who can join.");
  await db
    .update(t.rooms)
    .set({
      ...(patch.name !== undefined && { name: patch.name, symbol: symbolOf(patch.name) }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.rules !== undefined && { rules: patch.rules }),
      ...(patch.disclosure !== undefined && { disclosure: patch.disclosure }),
      ...(patch.privacy !== undefined && { privacy: patch.privacy === "Public" ? ("public" as const) : ("invite" as const) }),
    })
    .where(eq(t.rooms.id, room.id));
  return getRoom(deps, db, viewer, slug);
}

export async function archiveRoom(deps: RoomDeps, db: Db, viewer: Viewer, slug: string) {
  const { room, member } = await asMember(db, viewer, slug);
  if (member.role !== "owner") throw forbidden("Only the owner can archive the room.");
  await db.update(t.rooms).set({ archivedAt: deps.clock.now() }).where(eq(t.rooms.id, room.id));
  return { archived: true };
}

async function addMember(tx: Tx, room: Room, userId: string, now: Date) {
  const added = await tx
    .insert(t.roomMembers)
    .values({ roomId: room.id, userId, role: "member", joinedAt: now, lastSeenAt: now })
    .onConflictDoNothing()
    .returning({ userId: t.roomMembers.userId });
  if (!added.length) return false;
  await tx.update(t.rooms).set({ memberCount: sql`${t.rooms.memberCount} + 1` }).where(eq(t.rooms.id, room.id));
  await tx.delete(t.roomRequests).where(and(eq(t.roomRequests.roomId, room.id), eq(t.roomRequests.userId, userId)));
  // The join shows in #general, as a system line.
  const [general] = await tx
    .select({ id: t.channels.id })
    .from(t.channels)
    .where(and(eq(t.channels.roomId, room.id), eq(t.channels.slug, GENERAL_CHANNEL)));
  if (general)
    await tx.insert(t.roomMessages).values({ roomId: room.id, channelId: general.id, authorId: userId, kind: "join", createdAt: now });
  await appendEvent(tx, "room.joined", `room:${room.id}`, { roomId: room.id, userId });
  return true;
}

export async function joinRoom(deps: RoomDeps, db: Db, viewer: Viewer, slug: string) {
  await db.transaction(async (tx) => {
    const room = await roomBySlug(tx, slug);
    if (room.archivedAt) throw conflict("room_archived", "This room is archived.");
    if (room.privacy === "invite" && !(await membership(tx, room.id, viewer.userId)))
      throw forbidden("This room is invite only: ask to join instead.");
    await addMember(tx, room, viewer.userId, deps.clock.now());
  });
  return getRoom(deps, db, viewer, slug);
}

export async function leaveRoom(deps: RoomDeps, db: Db, viewer: Viewer, slug: string) {
  await db.transaction(async (tx) => {
    const { room, member } = await asMember(tx, viewer, slug);
    if (member.role === "owner") throw conflict("owner_leaving", "Owners can't leave their room; archive it instead.");
    await tx.delete(t.roomMembers).where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, viewer.userId)));
    await tx.update(t.rooms).set({ memberCount: sql`greatest(0, ${t.rooms.memberCount} - 1)` }).where(eq(t.rooms.id, room.id));
  });
  return { left: true };
}

export async function requestToJoin(deps: RoomDeps, db: Db, viewer: Viewer, slug: string) {
  await db.transaction(async (tx) => {
    const room = await roomBySlug(tx, slug);
    if (room.archivedAt) throw conflict("room_archived", "This room is archived.");
    if (room.privacy === "public") throw invalid("Public rooms are open: just join.");
    if (await membership(tx, room.id, viewer.userId)) return;
    const created = await tx
      .insert(t.roomRequests)
      .values({ roomId: room.id, userId: viewer.userId, createdAt: deps.clock.now() })
      .onConflictDoNothing()
      .returning({ userId: t.roomRequests.userId });
    if (created.length)
      await appendEvent(tx, "room.requested", `room:${room.id}`, { roomId: room.id, userId: viewer.userId });
  });
  return getRoom(deps, db, viewer, slug);
}

export async function answerRequest(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, handle: string, approve: boolean) {
  await db.transaction(async (tx) => {
    const { room } = await asModerator(tx, viewer, slug);
    const userId = await userIdByHandle(tx, handle);
    const removed = await tx
      .delete(t.roomRequests)
      .where(and(eq(t.roomRequests.roomId, room.id), eq(t.roomRequests.userId, userId)))
      .returning({ userId: t.roomRequests.userId });
    if (!removed.length) throw notFound("That request");
    if (approve) await addMember(tx, room, userId, deps.clock.now());
    await appendEvent(tx, "room.answered", `room:${room.id}`, { roomId: room.id, userId, approve, by: viewer.userId });
  });
  return getRoom(deps, db, viewer, slug);
}

export async function setRole(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, handle: string, role: "Moderator" | "Member") {
  await db.transaction(async (tx) => {
    const { room, member } = await asMember(tx, viewer, slug);
    if (member.role !== "owner") throw forbidden("Only the owner can change roles.");
    const userId = await userIdByHandle(tx, handle);
    if (userId === viewer.userId) throw invalid("You're the owner.");
    const updated = await tx
      .update(t.roomMembers)
      .set({ role: role === "Moderator" ? "moderator" : "member" })
      .where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, userId)))
      .returning({ userId: t.roomMembers.userId });
    if (!updated.length) throw notFound("That member");
  });
  return getRoom(deps, db, viewer, slug);
}

export async function removeMember(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, handle: string) {
  await db.transaction(async (tx) => {
    const { room, member } = await asModerator(tx, viewer, slug);
    const userId = await userIdByHandle(tx, handle);
    const target = await membership(tx, room.id, userId);
    if (!target) throw notFound("That member");
    const outranks: Record<Role, number> = { owner: 2, moderator: 1, member: 0 };
    if (outranks[target.role] >= outranks[member.role]) throw forbidden("You can only remove people below you.");
    await tx.delete(t.roomMembers).where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, userId)));
    await tx.update(t.rooms).set({ memberCount: sql`greatest(0, ${t.rooms.memberCount} - 1)` }).where(eq(t.rooms.id, room.id));
  });
  return getRoom(deps, db, viewer, slug);
}

export async function setRoomNotify(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, notify: keyof typeof NOTIFY_KEYS) {
  const { room } = await asMember(db, viewer, slug);
  await db
    .update(t.roomMembers)
    .set({ notify: NOTIFY_KEYS[notify] })
    .where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, viewer.userId)));
  return getRoom(deps, db, viewer, slug);
}

export async function createChannel(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, input: { name: string; topic: string; market?: string }) {
  await db.transaction(async (tx) => {
    const { room } = await asModerator(tx, viewer, slug);
    const channel = slugify(input.name);
    if (channel === PREDICTIONS_CHANNEL) throw invalid("That name is taken by the predictions list.");
    let marketId: string | null = null;
    if (input.market) {
      const [m] = await tx.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.slug, input.market));
      if (!m) throw notFound("That market");
      marketId = m.id;
    }
    const [{ n }] = await tx.select({ n: count() }).from(t.channels).where(eq(t.channels.roomId, room.id));
    if (n >= 30) throw invalid("A room can have up to 30 channels.");
    const created = await tx
      .insert(t.channels)
      .values({ roomId: room.id, slug: channel, topic: input.topic, marketId, position: n })
      .onConflictDoNothing()
      .returning({ id: t.channels.id });
    if (!created.length) throw conflict("channel_exists", "There's already a channel with that name.");
  });
  return getRoom(deps, db, viewer, slug);
}

async function channelOf(db: Queryable, room: Room, slug: string) {
  const [channel] = await db.select().from(t.channels).where(and(eq(t.channels.roomId, room.id), eq(t.channels.slug, slug)));
  if (!channel) throw notFound("That channel");
  return channel;
}

/** Messages in the UI's shape: authors, linked markets, reply counts, and —
    in disclosure rooms — each author's holding in the market discussed. */
async function hydrateMessages(db: Db, viewer: Viewer | null, room: Room, rows: (typeof t.roomMessages.$inferSelect)[]) {
  if (!rows.length) return [];
  const [channels, authors, markets, replies] = await Promise.all([
    db.select({ id: t.channels.id, slug: t.channels.slug, marketId: t.channels.marketId }).from(t.channels).where(eq(t.channels.roomId, room.id)),
    db
      .select()
      .from(t.users)
      .where(inArray(t.users.id, [...new Set(rows.flatMap((m) => [m.authorId, ...(m.withIds ?? [])]))]))
      .then((users) => traderSummaries(db, viewer, users)),
    (() => {
      const ids = [...new Set(rows.map((m) => m.marketId).filter((id): id is string => !!id))];
      return ids.length ? db.select({ id: t.markets.id, slug: t.markets.slug, scale: t.markets.quantityScale }).from(t.markets).where(inArray(t.markets.id, ids)) : Promise.resolve([]);
    })(),
    db
      .select({ parentId: t.roomMessages.parentId, n: count(), last: sql<Date>`max(${t.roomMessages.createdAt})` })
      .from(t.roomMessages)
      .where(and(inArray(t.roomMessages.parentId, rows.map((m) => m.id)), isNull(t.roomMessages.deletedAt)))
      .groupBy(t.roomMessages.parentId),
  ]);
  const channelOfId = new Map(channels.map((c) => [c.id, c]));
  const marketOf = new Map(markets.map((m) => [m.id, m]));
  const authorOf = new Map(authors.map((a) => [a.id, a]));

  // Disclosure: the author's position in the linked (or channel's) market.
  const holdings = new Map<string, { outcome: "Yes" | "No"; shares: number }[]>();
  if (room.disclosure) {
    const pairs = rows
      .map((m) => ({ author: m.authorId, market: m.marketId ?? channelOfId.get(m.channelId)?.marketId ?? null }))
      .filter((p): p is { author: string; market: string } => !!p.market);
    if (pairs.length) {
      const held = await db
        .select({ userId: t.tradingAccounts.userId, marketId: t.positions.marketId, outcome: t.positions.outcome, quantity: t.positions.quantity, scale: t.markets.quantityScale })
        .from(t.positions)
        .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.id, t.positions.accountId))
        .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
        .innerJoin(t.userSettings, eq(t.userSettings.userId, t.tradingAccounts.userId))
        .where(
          and(
            inArray(t.tradingAccounts.userId, [...new Set(pairs.map((p) => p.author))]),
            inArray(t.positions.marketId, [...new Set(pairs.map((p) => p.market))]),
            eq(t.userSettings.privateOpenPositions, false),
          ),
        );
      for (const h of held) {
        const key = `${h.userId}:${h.marketId}`;
        holdings.set(key, [...(holdings.get(key) ?? []), { outcome: h.outcome === "yes" ? "Yes" : "No", shares: h.quantity / 10 ** h.scale }]);
      }
    }
  }
  return rows.map((m) => {
    const channel = channelOfId.get(m.channelId);
    const market = m.marketId ? marketOf.get(m.marketId) : undefined;
    const reply = replies.find((r) => r.parentId === m.id);
    const discussed = m.marketId ?? channel?.marketId;
    return {
      id: m.id,
      authorId: m.authorId,
      author: authorOf.get(m.authorId)!,
      text: m.deletedAt ? "" : m.text,
      at: m.createdAt.toISOString(),
      channel: channel?.slug ?? GENERAL_CHANNEL,
      ...(market ? { marketId: market.slug } : {}),
      ...(m.parentId ? { parentId: m.parentId } : {}),
      ...(m.kind === "join" ? { kind: "join" as const, with: m.withIds ?? [] } : {}),
      replies: reply ? { count: reply.n, lastAt: new Date(reply.last).toISOString() } : null,
      editedAt: m.editedAt?.toISOString() ?? null,
      deleted: !!m.deletedAt,
      holdings: discussed ? (holdings.get(`${m.authorId}:${discussed}`) ?? []) : [],
      mine: viewer?.userId === m.authorId,
    };
  });
}

export type MessageView = Awaited<ReturnType<typeof hydrateMessages>>[number];

/**
 * A channel's messages, newest page first (`before` pages back), or one
 * thread's replies oldest first (`thread`).
 */
export async function listMessages(
  db: Db,
  viewer: Viewer | null,
  slug: string,
  channelSlug: string,
  query: { before?: string; thread?: string; limit?: number },
) {
  const { room } = await readable(db, viewer, slug);
  const channel = await channelOf(db, room, channelSlug);
  const limit = Math.min(query.limit ?? 50, 100);
  if (query.thread) {
    const [parent] = await db
      .select()
      .from(t.roomMessages)
      .where(and(eq(t.roomMessages.id, query.thread), eq(t.roomMessages.channelId, channel.id)));
    if (!parent) throw notFound("That thread");
    const replies = await db
      .select()
      .from(t.roomMessages)
      .where(and(eq(t.roomMessages.parentId, parent.id), isNull(t.roomMessages.deletedAt)))
      .orderBy(asc(t.roomMessages.createdAt))
      .limit(500);
    return { parent: (await hydrateMessages(db, viewer, room, [parent]))[0], items: await hydrateMessages(db, viewer, room, replies) };
  }
  const rows = await db
    .select()
    .from(t.roomMessages)
    .where(
      and(
        eq(t.roomMessages.channelId, channel.id),
        isNull(t.roomMessages.parentId),
        query.before ? sql`${t.roomMessages.createdAt} < ${query.before}::timestamptz` : undefined,
      ),
    )
    .orderBy(desc(t.roomMessages.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit).reverse(); // oldest → newest, as a chat reads
  return {
    items: await hydrateMessages(db, viewer, room, page),
    before: rows.length > limit ? page[0].createdAt.toISOString() : null,
  };
}

export async function postMessage(
  deps: RoomDeps,
  db: Db,
  viewer: Viewer,
  slug: string,
  input: { channel?: string; text: string; market?: string; parentId?: string; clientId?: string },
) {
  const { room, message } = await db.transaction(async (tx) => {
    const { room } = await asMember(tx, viewer, slug);
    if (input.clientId) {
      const [existing] = await tx
        .select()
        .from(t.roomMessages)
        .where(and(eq(t.roomMessages.authorId, viewer.userId), eq(t.roomMessages.clientId, input.clientId)));
      if (existing) return { room, message: existing };
    }
    let channelId: string;
    let parentId: string | null = null;
    if (input.parentId) {
      const [parent] = await tx
        .select()
        .from(t.roomMessages)
        .where(and(eq(t.roomMessages.id, input.parentId), eq(t.roomMessages.roomId, room.id), isNull(t.roomMessages.deletedAt)));
      if (!parent) throw notFound("The message you're replying to");
      channelId = parent.channelId;
      parentId = parent.parentId ?? parent.id; // threads are one level deep
    } else {
      const channel = await channelOf(tx, room, input.channel ?? GENERAL_CHANNEL);
      if (channel.slug === PREDICTIONS_CHANNEL) throw invalid("Post a prediction to add to this channel.");
      channelId = channel.id;
    }
    let marketId: string | null = null;
    if (input.market) {
      const [m] = await tx.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.slug, input.market));
      if (!m) throw notFound("That market");
      marketId = m.id;
    }
    if (!input.text.trim() && !marketId) throw invalid("Write something, or link a market.");
    const now = deps.clock.now();
    const [message] = await tx
      .insert(t.roomMessages)
      .values({
        roomId: room.id,
        channelId,
        authorId: viewer.userId,
        parentId,
        text: input.text,
        marketId,
        clientId: input.clientId ?? null,
        createdAt: now,
      })
      .returning();
    await tx
      .update(t.roomMembers)
      .set({ lastSeenAt: now })
      .where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, viewer.userId)));
    // Posting reads the channel up to your own message.
    await tx
      .insert(t.channelReads)
      .values({ userId: viewer.userId, channelId, lastReadAt: now })
      .onConflictDoUpdate({ target: [t.channelReads.userId, t.channelReads.channelId], set: { lastReadAt: now } });
    await appendEvent(tx, "room.message", `room:${room.id}`, {
      roomId: room.id,
      messageId: message.id,
      authorId: viewer.userId,
      parentId,
      mentions: await mentionedUsers(tx, input.text, viewer.userId),
    });
    return { room, message };
  });
  return (await hydrateMessages(db, viewer, room, [message]))[0];
}

export async function editMessage(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, id: string, text: string) {
  const { room } = await asMember(db, viewer, slug);
  const [message] = await db
    .update(t.roomMessages)
    .set({ text, editedAt: deps.clock.now() })
    .where(and(eq(t.roomMessages.id, id), eq(t.roomMessages.roomId, room.id), eq(t.roomMessages.authorId, viewer.userId), isNull(t.roomMessages.deletedAt), eq(t.roomMessages.kind, "message")))
    .returning();
  if (!message) throw notFound("Your message");
  await appendEvent(db, "room.message.edited", `room:${room.id}`, { roomId: room.id, messageId: id });
  return (await hydrateMessages(db, viewer, room, [message]))[0];
}

/** Authors remove their own messages; moderators remove anyone's. */
export async function deleteMessage(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, id: string) {
  const { room, member } = await asMember(db, viewer, slug);
  const [message] = await db.select().from(t.roomMessages).where(and(eq(t.roomMessages.id, id), eq(t.roomMessages.roomId, room.id)));
  if (!message || message.deletedAt) throw notFound("That message");
  if (message.authorId !== viewer.userId && member.role === "member") throw forbidden("You can remove your own messages.");
  await db.update(t.roomMessages).set({ deletedAt: deps.clock.now() }).where(eq(t.roomMessages.id, id));
  await appendEvent(db, "room.message.deleted", `room:${room.id}`, { roomId: room.id, messageId: id });
  return { deleted: true };
}

export async function markChannelRead(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, channelSlug: string) {
  const { room } = await asMember(db, viewer, slug);
  const channel = await channelOf(db, room, channelSlug);
  const now = deps.clock.now();
  await db
    .insert(t.channelReads)
    .values({ userId: viewer.userId, channelId: channel.id, lastReadAt: now })
    .onConflictDoUpdate({ target: [t.channelReads.userId, t.channelReads.channelId], set: { lastReadAt: now } });
  await db
    .update(t.roomMembers)
    .set({ lastSeenAt: now })
    .where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, viewer.userId)));
  return { channel: channel.slug, lastReadAt: now.toISOString() };
}

/** Share markets to the room's list; returns how many were new. */
async function addMarkets(tx: Tx, room: Room, viewer: Viewer, slugs: string[]) {
  if (!slugs.length) return 0;
  const markets = await tx.select({ id: t.markets.id, slug: t.markets.slug }).from(t.markets).where(inArray(t.markets.slug, slugs));
  if (markets.length !== new Set(slugs).size) throw notFound("One of those markets");
  const existing = await tx.select({ marketId: t.roomMarkets.marketId, rank: t.roomMarkets.rank }).from(t.roomMarkets).where(eq(t.roomMarkets.roomId, room.id));
  const ranks = existing.map((e) => e.rank);
  let added = 0;
  for (const slug of slugs) {
    const market = markets.find((m) => m.slug === slug)!;
    if (existing.some((e) => e.marketId === market.id)) continue;
    if (existing.length + added >= MAX_ROOM_MARKETS) throw invalid(`A room follows up to ${MAX_ROOM_MARKETS} markets.`);
    const rank = rankAt(ranks, ranks.length);
    ranks.push(rank);
    await tx.insert(t.roomMarkets).values({ roomId: room.id, marketId: market.id, addedBy: viewer.userId, rank }).onConflictDoNothing();
    await appendEvent(tx, "room.market", `room:${room.id}`, { roomId: room.id, marketId: market.id, by: viewer.userId });
    added++;
  }
  return added;
}

export async function addRoomMarkets(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, markets: string[]) {
  const added = await db.transaction(async (tx) => {
    const { room } = await asMember(tx, viewer, slug);
    return addMarkets(tx, room, viewer, [...new Set(markets)]);
  });
  return { added, room: await getRoom(deps, db, viewer, slug) };
}

/** Whoever added a market, or a moderator, can take it off the list. */
export async function removeRoomMarket(deps: RoomDeps, db: Db, viewer: Viewer, slug: string, market: string) {
  await db.transaction(async (tx) => {
    const { room, member } = await asMember(tx, viewer, slug);
    const [row] = await tx
      .select({ marketId: t.roomMarkets.marketId, addedBy: t.roomMarkets.addedBy })
      .from(t.roomMarkets)
      .innerJoin(t.markets, eq(t.markets.id, t.roomMarkets.marketId))
      .where(and(eq(t.roomMarkets.roomId, room.id), eq(t.markets.slug, market)));
    if (!row) return;
    if (row.addedBy !== viewer.userId && member.role === "member") throw forbidden("Ask a moderator to take it off.");
    await tx.delete(t.roomMarkets).where(and(eq(t.roomMarkets.roomId, room.id), eq(t.roomMarkets.marketId, row.marketId)));
  });
  return getRoom(deps, db, viewer, slug);
}


/** A message as everyone in the room sees it, for realtime. */
export async function messageForBroadcast(db: Db, roomId: string, messageId: string) {
  const [room] = await db.select().from(t.rooms).where(eq(t.rooms.id, roomId));
  const [message] = await db.select().from(t.roomMessages).where(eq(t.roomMessages.id, messageId));
  if (!room || !message) return null;
  const [view] = await hydrateMessages(db, null, room, [message]);
  return { room, message, view };
}
