/**
 * Predictions: a call on a market, stamped with the market's price when
 * posted and — if the author chooses — their actual position, attested from
 * the ledger rather than typed in. Editable for five minutes, then fixed, so
 * track records stay honest. Feeds, reactions, comments and views live here.
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Deps } from "../composition";
import type { Db, Queryable } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { conflict, forbidden, notFound } from "../errors";
import { appendEvent } from "../outbox";
import { traderSummaries } from "./people";
import { checkUpload } from "./uploads";
import type { Viewer } from "./viewer";

export const EDIT_WINDOW_MS = 5 * 60_000;
const ONE = 1_000_000;

type PostRow = typeof t.posts.$inferSelect;
type PostDeps = Pick<Deps, "storage" | "clock">;

/** Handles mentioned with @, resolved to people. */
export async function mentionedUsers(db: Queryable, text: string, except: string) {
  const handles = [...new Set([...text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9_]{2,24})\b/g)].map((m) => m[1].toLowerCase()))].slice(0, 10);
  if (!handles.length) return [];
  const rows = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(and(sql`lower(${t.users.handle}) in ${handles}`, isNull(t.users.deletedAt)));
  return rows.map((r) => r.id).filter((id) => id !== except);
}

/** Posts the viewer may see: public ones, their own, and their rooms'. */
function visibleTo(viewer: Viewer | null): SQL {
  if (!viewer) return and(isNull(t.posts.deletedAt), isNull(t.posts.roomId))!;
  return and(
    isNull(t.posts.deletedAt),
    or(
      isNull(t.posts.roomId),
      eq(t.posts.authorId, viewer.userId),
      sql`exists (select 1 from room_members rm where rm.room_id = ${t.posts.roomId} and rm.user_id = ${viewer.userId})`,
    ),
  )!;
}

/**
 * What each person holds in a market — the stake a reply carries, so
 * agreement is legible. Private positions stay private (except your own).
 */
export async function stakes(db: Db, viewer: Viewer | null, pairs: { marketId: string; userId: string }[]) {
  const out = new Map<string, { outcome: "Yes" | "No"; shares: number }>();
  if (!pairs.length) return out;
  const rows = await db
    .select({
      marketId: t.positions.marketId,
      userId: t.tradingAccounts.userId,
      outcome: t.positions.outcome,
      quantity: t.positions.quantity,
      scale: t.markets.quantityScale,
    })
    .from(t.positions)
    .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.id, t.positions.accountId))
    .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
    .innerJoin(t.userSettings, eq(t.userSettings.userId, t.tradingAccounts.userId))
    .where(
      and(
        inArray(t.positions.marketId, [...new Set(pairs.map((p) => p.marketId))]),
        inArray(t.tradingAccounts.userId, [...new Set(pairs.map((p) => p.userId))]),
        viewer
          ? or(eq(t.userSettings.privateOpenPositions, false), eq(t.tradingAccounts.userId, viewer.userId))
          : eq(t.userSettings.privateOpenPositions, false),
      ),
    );
  for (const r of rows) {
    const key = `${r.marketId}:${r.userId}`;
    const shares = r.quantity / 10 ** r.scale;
    // Someone on both sides shows their bigger side.
    if ((out.get(key)?.shares ?? 0) < shares) out.set(key, { outcome: r.outcome === "yes" ? "Yes" : "No", shares });
  }
  return out;
}

const imageSrc = (deps: PostDeps, key: string) =>
  // Seeded figures ship with the app (/media/…); uploads live in storage.
  key.startsWith("/") ? key : deps.storage.publicUrl(key);

/** Posts in the UI's shape, with authors and the viewer's reactions. */
export async function hydratePosts(deps: PostDeps, db: Db, viewer: Viewer | null, rows: PostRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const roomIds = [...new Set(rows.map((p) => p.roomId).filter((r): r is string => !!r))];
  const [authors, markets, rooms, images, reactions] = await Promise.all([
    db
      .select()
      .from(t.users)
      .where(inArray(t.users.id, [...new Set(rows.map((p) => p.authorId))]))
      .then((users) => traderSummaries(db, viewer, users)),
    db
      .select({ id: t.markets.id, slug: t.markets.slug, scale: t.markets.quantityScale })
      .from(t.markets)
      .where(inArray(t.markets.id, [...new Set(rows.map((p) => p.marketId))])),
    roomIds.length
      ? db.select({ id: t.rooms.id, slug: t.rooms.slug }).from(t.rooms).where(inArray(t.rooms.id, roomIds))
      : Promise.resolve([]),
    db.select().from(t.postImages).where(inArray(t.postImages.postId, ids)).orderBy(t.postImages.position),
    viewer
      ? db
          .select({ id: t.reactions.subjectId, kind: t.reactions.kind })
          .from(t.reactions)
          .where(and(eq(t.reactions.userId, viewer.userId), eq(t.reactions.subjectType, "post"), inArray(t.reactions.subjectId, ids)))
      : Promise.resolve([]),
  ]);
  // Each post's two most-liked replies, for the feed's inline preview.
  const previews = await db
    .select()
    .from(t.comments)
    .where(
      sql`${t.comments.id} in (
        select id from (
          select c.id, row_number() over (partition by c.post_id order by c.likes desc, c.created_at) as n
          from comments c
          where c.post_id in ${ids} and c.parent_id is null and c.deleted_at is null
        ) ranked where n <= 2)`,
    );
  const previewAuthors = previews.length
    ? await traderSummaries(
        db,
        viewer,
        await db.select().from(t.users).where(inArray(t.users.id, [...new Set(previews.map((c) => c.authorId))])),
      )
    : [];
  const authorOf = new Map([...previewAuthors, ...authors].map((a) => [a.id, a]));
  const marketIdOf = new Map(rows.map((p) => [p.id, p.marketId]));
  const previewStakes = await stakes(
    db,
    viewer,
    previews.map((c) => ({ marketId: marketIdOf.get(c.postId)!, userId: c.authorId })),
  );
  // Who backed each call: the latest three people whose filled buy on the
  // post's side came from its Back button.
  const backerRows = await db.execute<{ post_id: string; handle: string; avatar_url: string | null }>(sql`
    select b.post_id, u.handle, u.avatar_url from (
      select o.post_id, o.user_id, row_number() over (partition by o.post_id order by max(o.created_at) desc) as n
      from orders o join posts p on p.id = o.post_id
      where o.post_id in ${ids} and o.side = 'buy' and o.filled_quantity > 0 and o.outcome = p.outcome
      group by o.post_id, o.user_id
    ) b join users u on u.id = b.user_id
    where b.n <= 3 and u.deleted_at is null
    order by b.post_id, b.n`);
  const backersOf = new Map<string, { handle: string; avatarUrl: string | null }[]>();
  for (const r of backerRows) backersOf.set(r.post_id, [...(backersOf.get(r.post_id) ?? []), { handle: r.handle, avatarUrl: r.avatar_url }]);
  const marketOf = new Map(markets.map((m) => [m.id, m]));
  const roomOf = new Map(rooms.map((r) => [r.id, r.slug]));
  const now = deps.clock.now().getTime();
  return rows.map((p) => {
    const market = marketOf.get(p.marketId)!;
    const mine = viewer?.userId === p.authorId;
    const reacted = (kind: string) => reactions.some((r) => r.id === p.id && r.kind === kind);
    return {
      id: p.id,
      authorId: p.authorId,
      author: authorOf.get(p.authorId)!,
      marketId: market.slug,
      outcome: p.outcome === "yes" ? ("Yes" as const) : ("No" as const),
      entryPrice: cents(p.entryPrice),
      text: p.text,
      ...(p.invalidation ? { invalidation: p.invalidation } : {}),
      confidence: p.confidence,
      disclosePosition: p.disclosePosition,
      audience: p.roomId ? (roomOf.get(p.roomId) ?? "room") : "public",
      at: p.createdAt.toISOString(),
      editedAt: p.editedAt?.toISOString() ?? null,
      editableUntil: mine && p.editableUntil.getTime() > now ? p.editableUntil.toISOString() : null,
      likes: p.likes,
      reposts: p.reposts,
      views: p.views,
      backed: p.backed,
      /** A few of the people who backed it (newest first), for the avatars beside the count. */
      backers: backersOf.get(p.id) ?? [],
      faded: p.faded,
      commentCount: p.comments,
      evidenceShares: p.disclosePosition ? p.evidenceShares : 0,
      position:
        p.disclosePosition && p.positionSnapshot
          ? {
              shares: p.positionSnapshot.quantity / 10 ** market.scale,
              averagePriceCents: cents(p.positionSnapshot.averagePrice),
            }
          : null,
      images: images
        .filter((i) => i.postId === p.id)
        .map((i) => ({ src: imageSrc(deps, i.storageKey), alt: i.alt, caption: i.caption, width: i.width, height: i.height })),
      comments: previews
        .filter((c) => c.postId === p.id)
        .sort((a, b) => b.likes - a.likes || a.createdAt.getTime() - b.createdAt.getTime())
        .map((c) => ({
          id: c.id,
          authorId: c.authorId,
          author: authorOf.get(c.authorId)!,
          text: c.text,
          at: c.createdAt.toISOString(),
          likes: c.likes,
          stake: previewStakes.get(`${p.marketId}:${c.authorId}`) ?? null,
          viewer: viewer ? { liked: false, mine: c.authorId === viewer.userId } : null,
        })) as Awaited<ReturnType<typeof listComments>>["items"],
      viewer: viewer ? { liked: reacted("like"), bookmarked: reacted("bookmark"), reposted: reacted("repost"), mine } : null,
    };
  });
}

export type PostView = Awaited<ReturnType<typeof hydratePosts>>[number];

export interface PostInput {
  market: string;
  outcome: "Yes" | "No";
  text: string;
  invalidation?: string;
  confidence: "Low" | "Medium" | "High";
  disclosePosition: boolean;
  /** "public", or the slug of a room you belong to. */
  audience: string;
  images?: { key: string; alt: string; caption?: string; width: number; height: number }[];
  clientId?: string;
}

async function roomForPosting(db: Queryable, viewer: Viewer, slug: string) {
  const [room] = await db
    .select({ id: t.rooms.id, archivedAt: t.rooms.archivedAt })
    .from(t.rooms)
    .innerJoin(t.roomMembers, and(eq(t.roomMembers.roomId, t.rooms.id), eq(t.roomMembers.userId, viewer.userId)))
    .where(eq(t.rooms.slug, slug));
  if (!room) throw forbidden("Post to rooms you belong to.");
  if (room.archivedAt) throw conflict("room_archived", "That room is archived.");
  return room.id;
}

export async function createPost(deps: PostDeps, db: Db, viewer: Viewer, input: PostInput) {
  if (input.clientId) {
    const [existing] = await db
      .select()
      .from(t.posts)
      .where(and(eq(t.posts.authorId, viewer.userId), eq(t.posts.clientId, input.clientId)));
    if (existing) return (await hydratePosts(deps, db, viewer, [existing]))[0];
  }
  const [row] = await db
    .select({ market: t.markets, quote: t.marketQuotes })
    .from(t.markets)
    .leftJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .where(eq(t.markets.slug, input.market));
  if (!row) throw notFound("That market");
  const { market, quote } = row;
  if (market.status !== "open" && market.status !== "paused")
    throw conflict("market_not_open", "Predictions are for markets that are still trading.");
  if (!quote || quote.last === null)
    throw conflict("no_price", "This market has no price yet, so a prediction can't be stamped.");
  for (const image of input.images ?? []) await checkUpload(deps, viewer, "evidence", image.key);

  const outcome = input.outcome === "Yes" ? "yes" : "no";
  // Stamped by the server: the price when posted, never one typed in.
  const entryPrice = outcome === "yes" ? quote.last : ONE - quote.last;
  const now = deps.clock.now();
  const post = await db.transaction(async (tx) => {
    const roomId = input.audience === "public" ? null : await roomForPosting(tx, viewer, input.audience);
    let snapshot: PostRow["positionSnapshot"] = null;
    if (input.disclosePosition) {
      const [position] = await tx
        .select({ quantity: t.positions.quantity, cost: t.positions.cost })
        .from(t.positions)
        .innerJoin(t.tradingAccounts, eq(t.tradingAccounts.id, t.positions.accountId))
        .where(and(eq(t.tradingAccounts.userId, viewer.userId), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome)));
      if (position?.quantity)
        snapshot = {
          quantity: position.quantity,
          averagePrice: Math.round((position.cost * 10 ** market.quantityScale) / position.quantity),
          outcome,
        };
    }
    const [post] = await tx
      .insert(t.posts)
      .values({
        authorId: viewer.userId,
        marketId: market.id,
        outcome,
        entryPrice,
        text: input.text,
        invalidation: input.invalidation || null,
        confidence: input.confidence,
        disclosePosition: input.disclosePosition,
        positionSnapshot: snapshot,
        evidenceShares: snapshot ? Math.floor(snapshot.quantity / 10 ** market.quantityScale) : 0,
        roomId,
        editableUntil: new Date(now.getTime() + EDIT_WINDOW_MS),
        clientId: input.clientId ?? null,
        createdAt: now,
      })
      .returning();
    if (input.images?.length)
      await tx.insert(t.postImages).values(
        input.images.map((image, position) => ({
          postId: post.id,
          storageKey: image.key,
          alt: image.alt,
          caption: image.caption ?? "",
          width: image.width,
          height: image.height,
          position,
        })),
      );
    await appendEvent(tx, "post.created", `post:${post.id}`, {
      postId: post.id,
      authorId: viewer.userId,
      roomId,
      market: market.slug,
      mentions: await mentionedUsers(tx, `${input.text} ${input.invalidation ?? ""}`, viewer.userId),
    });
    return post;
  });
  return (await hydratePosts(deps, db, viewer, [post]))[0];
}

async function ownPost(db: Queryable, viewer: Viewer, id: string, now: Date) {
  const [post] = await db.select().from(t.posts).where(and(eq(t.posts.id, id), isNull(t.posts.deletedAt)));
  if (!post) throw notFound("That prediction");
  if (post.authorId !== viewer.userId) throw forbidden("Only the author can change a prediction.");
  if (post.editableUntil.getTime() <= now.getTime())
    throw conflict("locked", "Predictions are on the record five minutes after posting.");
  return post;
}

export async function editPost(
  deps: PostDeps,
  db: Db,
  viewer: Viewer,
  id: string,
  patch: { text?: string; invalidation?: string | null; confidence?: "Low" | "Medium" | "High" },
) {
  const now = deps.clock.now();
  await ownPost(db, viewer, id, now);
  const [post] = await db
    .update(t.posts)
    .set({
      ...(patch.text !== undefined && { text: patch.text }),
      ...(patch.invalidation !== undefined && { invalidation: patch.invalidation || null }),
      ...(patch.confidence !== undefined && { confidence: patch.confidence }),
      editedAt: now,
    })
    .where(eq(t.posts.id, id))
    .returning();
  return (await hydratePosts(deps, db, viewer, [post]))[0];
}

export async function deletePost(deps: PostDeps, db: Db, viewer: Viewer, id: string) {
  await ownPost(db, viewer, id, deps.clock.now());
  await db.update(t.posts).set({ deletedAt: deps.clock.now() }).where(eq(t.posts.id, id));
  return { deleted: true };
}

export const FEEDS = ["for-you", "latest", "following", "bookmarks"] as const;

export interface FeedQuery {
  feed?: (typeof FEEDS)[number];
  market?: string;
  trader?: string;
  room?: string;
  cursor?: string;
  limit?: number;
}

const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString();

export async function listPosts(deps: PostDeps, db: Db, viewer: Viewer | null, query: FeedQuery) {
  const limit = Math.min(query.limit ?? 20, 50);
  const feed = query.feed ?? "for-you";
  const where: (SQL | undefined)[] = [visibleTo(viewer)];

  if (query.market) {
    const [m] = await db.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.slug, query.market));
    if (!m) throw notFound("That market");
    where.push(eq(t.posts.marketId, m.id));
  }
  if (query.trader) {
    const [u] = await db.select({ id: t.users.id }).from(t.users).where(sql`lower(${t.users.handle}) = lower(${query.trader})`);
    if (!u) throw notFound("That trader");
    where.push(eq(t.posts.authorId, u.id));
  }
  if (query.room) {
    const [room] = await db.select().from(t.rooms).where(eq(t.rooms.slug, query.room));
    if (!room) throw notFound("That room");
    if (room.privacy === "invite") {
      const member = viewer
        ? await db.select().from(t.roomMembers).where(and(eq(t.roomMembers.roomId, room.id), eq(t.roomMembers.userId, viewer.userId)))
        : [];
      if (!member.length) throw forbidden("Join this room to see its predictions.");
    }
    // Posted to the room, or public on a market the room follows.
    where.push(
      or(
        eq(t.posts.roomId, room.id),
        and(isNull(t.posts.roomId), sql`${t.posts.marketId} in (select market_id from room_markets where room_id = ${room.id})`),
      ),
    );
  }
  if (feed === "following") {
    if (!viewer) return { items: [], next: undefined };
    where.push(sql`${t.posts.authorId} in (select followee_id from follows where follower_id = ${viewer.userId})`);
  }
  if (feed === "bookmarks") {
    if (!viewer) return { items: [], next: undefined };
    where.push(
      sql`${t.posts.id} in (select subject_id from reactions where user_id = ${viewer.userId} and subject_type = 'post' and kind = 'bookmark')`,
    );
  }
  // Only a plain For You feed is ranked; filtered ones read newest first.
  const ranked = feed === "for-you" && !query.market && !query.trader && !query.room;
  if (!ranked && query.room === undefined && query.trader === undefined && feed !== "bookmarks" && !query.market)
    where.push(isNull(t.posts.roomId)); // Latest and Following show public posts.

  let rows: PostRow[];
  let next: string | undefined;
  if (ranked) {
    const offset = query.cursor ? Number(decode(query.cursor)) || 0 : 0;
    const now = deps.clock.now().toISOString();
    const interests = viewer
      ? sql`coalesce((select interests from user_settings where user_id = ${viewer.userId}), '{}')`
      : sql`'{}'::text[]`;
    rows = (
      await db
        .select({ post: t.posts })
        .from(t.posts)
        .innerJoin(t.markets, eq(t.markets.id, t.posts.marketId))
        .where(and(...where, isNull(t.posts.roomId)))
        .orderBy(
          desc(sql`(${t.posts.likes} + 2 * ${t.posts.backed} + ${t.posts.faded} + 1.5 * ${t.posts.comments} + 2 * ${t.posts.reposts} + 1)
            * (case when ${t.markets.category} = any(${interests}) then 1.5 else 1 end)
            / power(greatest(extract(epoch from (${now}::timestamptz - ${t.posts.createdAt})) / 3600, 0) + 2, 1.5)`),
          desc(t.posts.createdAt),
        )
        .limit(limit + 1)
        .offset(offset)
    ).map((r) => r.post);
    if (rows.length > limit) next = encode(String(offset + limit));
  } else {
    if (query.cursor) {
      const [at, id] = decode(query.cursor).split("|");
      if (at && id) where.push(sql`(${t.posts.createdAt}, ${t.posts.id}) < (${at}::timestamptz, ${id}::uuid)`);
    }
    rows = await db
      .select()
      .from(t.posts)
      .where(and(...where))
      .orderBy(desc(t.posts.createdAt), desc(t.posts.id))
      .limit(limit + 1);
    if (rows.length > limit) {
      const last = rows[limit - 1];
      next = encode(`${last.createdAt.toISOString()}|${last.id}`);
    }
  }
  return { items: await hydratePosts(deps, db, viewer, rows.slice(0, limit)), next };
}

async function visiblePost(db: Queryable, viewer: Viewer | null, id: string) {
  const [post] = await db.select().from(t.posts).where(and(eq(t.posts.id, id), visibleTo(viewer)));
  if (!post) throw notFound("That prediction");
  return post;
}

export async function getPost(deps: PostDeps, db: Db, viewer: Viewer | null, id: string) {
  const post = await visiblePost(db, viewer, id);
  const [view] = await hydratePosts(deps, db, viewer, [post]);
  view.comments = (await listComments(db, viewer, id)).items;
  return view;
}

const COUNTERS = { like: t.posts.likes, repost: t.posts.reposts } as const;

/** Like, bookmark or repost — on (true) or off (false). Idempotent. */
export async function reactToPost(
  deps: PostDeps,
  db: Db,
  viewer: Viewer,
  id: string,
  kind: (typeof t.REACTION_KINDS)[number],
  on: boolean,
) {
  await db.transaction(async (tx) => {
    const post = await visiblePost(tx, viewer, id);
    const key = and(
      eq(t.reactions.userId, viewer.userId),
      eq(t.reactions.subjectType, "post"),
      eq(t.reactions.subjectId, post.id),
      eq(t.reactions.kind, kind),
    );
    const changed = on
      ? await tx
          .insert(t.reactions)
          .values({ userId: viewer.userId, subjectType: "post", subjectId: post.id, kind })
          .onConflictDoNothing()
          .returning({ kind: t.reactions.kind })
      : await tx.delete(t.reactions).where(key).returning({ kind: t.reactions.kind });
    const counter = kind === "bookmark" ? undefined : COUNTERS[kind];
    if (changed.length && counter)
      await tx
        .update(t.posts)
        .set({ [kind === "like" ? "likes" : "reposts"]: sql`greatest(0, ${counter} + ${on ? 1 : -1})` })
        .where(eq(t.posts.id, post.id));
    if (changed.length && on && kind === "like" && post.authorId !== viewer.userId)
      await appendEvent(tx, "post.liked", `post:${post.id}`, { postId: post.id, userId: viewer.userId, authorId: post.authorId });
  });
  return getPost(deps, db, viewer, id);
}

export async function listComments(db: Db, viewer: Viewer | null, postId: string) {
  const rows = await db
    .select()
    .from(t.comments)
    .where(and(eq(t.comments.postId, postId), isNull(t.comments.deletedAt)))
    .orderBy(t.comments.createdAt);
  const [post] = await db.select({ marketId: t.posts.marketId }).from(t.posts).where(eq(t.posts.id, postId));
  const held = post ? await stakes(db, viewer, rows.map((c) => ({ marketId: post.marketId, userId: c.authorId }))) : new Map();
  const authors = rows.length
    ? await traderSummaries(db, viewer, await db.select().from(t.users).where(inArray(t.users.id, [...new Set(rows.map((c) => c.authorId))])))
    : [];
  const liked = viewer && rows.length
    ? new Set(
        (
          await db
            .select({ id: t.reactions.subjectId })
            .from(t.reactions)
            .where(and(eq(t.reactions.userId, viewer.userId), eq(t.reactions.subjectType, "comment"), eq(t.reactions.kind, "like"), inArray(t.reactions.subjectId, rows.map((c) => c.id))))
        ).map((r) => r.id),
      )
    : new Set<string>();
  const authorOf = new Map(authors.map((a) => [a.id, a]));
  return {
    items: rows.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      author: authorOf.get(c.authorId)!,
      text: c.text,
      at: c.createdAt.toISOString(),
      ...(c.parentId ? { parentId: c.parentId } : {}),
      likes: c.likes,
      stake: (post && held.get(`${post.marketId}:${c.authorId}`)) ?? null,
      viewer: viewer ? { liked: liked.has(c.id), mine: c.authorId === viewer.userId } : null,
    })),
  };
}

export async function createComment(
  deps: PostDeps,
  db: Db,
  viewer: Viewer,
  postId: string,
  input: { text: string; parentId?: string; clientId?: string },
) {
  const created = await db.transaction(async (tx) => {
    const post = await visiblePost(tx, viewer, postId);
    if (input.clientId) {
      const [existing] = await tx
        .select({ id: t.comments.id })
        .from(t.comments)
        .where(and(eq(t.comments.authorId, viewer.userId), eq(t.comments.clientId, input.clientId)));
      if (existing) return existing.id;
    }
    let parent: typeof t.comments.$inferSelect | undefined;
    if (input.parentId) {
      [parent] = await tx
        .select()
        .from(t.comments)
        .where(and(eq(t.comments.id, input.parentId), eq(t.comments.postId, post.id), isNull(t.comments.deletedAt)));
      if (!parent) throw notFound("The comment you're replying to");
    }
    const [comment] = await tx
      .insert(t.comments)
      .values({
        postId: post.id,
        authorId: viewer.userId,
        // One level of replies: a reply to a reply joins its thread.
        parentId: parent ? (parent.parentId ?? parent.id) : null,
        text: input.text,
        clientId: input.clientId ?? null,
        createdAt: deps.clock.now(),
      })
      .returning();
    await tx.update(t.posts).set({ comments: sql`${t.posts.comments} + 1` }).where(eq(t.posts.id, post.id));
    await appendEvent(tx, "comment.created", `post:${post.id}`, {
      commentId: comment.id,
      postId: post.id,
      authorId: viewer.userId,
      postAuthorId: post.authorId,
      parentAuthorId: parent?.authorId ?? null,
      mentions: await mentionedUsers(tx, input.text, viewer.userId),
    });
    return comment.id;
  });
  const { items } = await listComments(db, viewer, postId);
  return items.find((c) => c.id === created)!;
}

/** The author, or the prediction's author, can remove a comment. */
export async function deleteComment(db: Db, viewer: Viewer, id: string, now: Date) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ comment: t.comments, postAuthor: t.posts.authorId })
      .from(t.comments)
      .innerJoin(t.posts, eq(t.posts.id, t.comments.postId))
      .where(and(eq(t.comments.id, id), isNull(t.comments.deletedAt)));
    if (!row) throw notFound("That comment");
    if (row.comment.authorId !== viewer.userId && row.postAuthor !== viewer.userId)
      throw forbidden("You can remove your own comments, and comments on your predictions.");
    await tx.update(t.comments).set({ deletedAt: now }).where(eq(t.comments.id, id));
    await tx
      .update(t.posts)
      .set({ comments: sql`greatest(0, ${t.posts.comments} - 1)` })
      .where(eq(t.posts.id, row.comment.postId));
  });
  return { deleted: true };
}

export async function likeComment(db: Db, viewer: Viewer, id: string, on: boolean) {
  return db.transaction(async (tx) => {
    const [comment] = await tx.select().from(t.comments).where(and(eq(t.comments.id, id), isNull(t.comments.deletedAt)));
    if (!comment) throw notFound("That comment");
    await visiblePost(tx, viewer, comment.postId);
    const changed = on
      ? await tx
          .insert(t.reactions)
          .values({ userId: viewer.userId, subjectType: "comment", subjectId: id, kind: "like" })
          .onConflictDoNothing()
          .returning({ kind: t.reactions.kind })
      : await tx
          .delete(t.reactions)
          .where(and(eq(t.reactions.userId, viewer.userId), eq(t.reactions.subjectType, "comment"), eq(t.reactions.subjectId, id), eq(t.reactions.kind, "like")))
          .returning({ kind: t.reactions.kind });
    const [updated] = changed.length
      ? await tx
          .update(t.comments)
          .set({ likes: sql`greatest(0, ${t.comments.likes} + ${on ? 1 : -1})` })
          .where(eq(t.comments.id, id))
          .returning({ likes: t.comments.likes })
      : [{ likes: comment.likes }];
    return { id, likes: updated.likes, liked: on };
  });
}

/** Feed impressions, counted once per viewer (or address) per six hours. */
export async function recordViews(
  deps: Pick<Deps, "cache">,
  db: Db,
  who: string,
  ids: string[],
) {
  const fresh: string[] = [];
  for (const id of [...new Set(ids)].slice(0, 50)) {
    const key = `view:${id}:${who}`;
    if (await deps.cache.get(key)) continue;
    await deps.cache.set(key, 1, 6 * 3_600);
    fresh.push(id);
  }
  if (fresh.length)
    await db
      .update(t.posts)
      .set({ views: sql`${t.posts.views} + 1` })
      .where(and(inArray(t.posts.id, fresh), isNull(t.posts.deletedAt)));
  return { counted: fresh.length };
}

/** Bookmarks without their posts: ids only, for the bookmark icons. */
export async function bookmarkIds(db: Db, viewer: Viewer) {
  const rows = await db
    .select({ id: t.reactions.subjectId })
    .from(t.reactions)
    .where(and(eq(t.reactions.userId, viewer.userId), eq(t.reactions.subjectType, "post"), eq(t.reactions.kind, "bookmark")))
    .orderBy(desc(t.reactions.createdAt));
  return rows.map((r) => r.id);
}

