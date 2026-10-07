/**
 * People: profiles, follows and the bell, and your own profile and settings.
 * Traders are addressed by handle in URLs and by id in data.
 */
import { and, desc, eq, gt, gte, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import { defaultAvatar, presetUrl, type AvatarPreset } from "@imo/core/avatars";
import { MIN_SAMPLE, NOTIFICATION_PREFERENCES, isReservedHandle } from "../catalogs";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { conflict, invalid, notFound } from "../errors";
import { appendEvent } from "../outbox";
import { readToken, signToken, tokenSecret } from "../tokens";
import { checkUpload } from "./uploads";
import type { Viewer } from "./viewer";

type UserRow = typeof t.users.$inferSelect;

const joinedLabel = (at: Date) =>
  at.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Room counts for a set of people (follow counts are kept on the user). */
async function countsFor(db: Db, users: UserRow[]) {
  const ids = users.map((u) => u.id);
  if (!ids.length) return new Map<string, { followers: number; following: number; rooms: number }>();
  const [rooms] = await Promise.all([
    db
      .select({ id: t.roomMembers.userId, n: sql<number>`count(*)::int` })
      .from(t.roomMembers)
      .innerJoin(t.rooms, eq(t.rooms.id, t.roomMembers.roomId))
      .where(and(inArray(t.roomMembers.userId, ids), isNull(t.rooms.archivedAt)))
      .groupBy(t.roomMembers.userId),
  ]);
  const map = new Map(users.map((u) => [u.id, { followers: u.followersCount, following: u.followingCount, rooms: 0 }]));
  for (const r of rooms) map.get(r.id)!.rooms = r.n;
  return map;
}

/** The people a list shows, with counts and the viewer's relationship. */
export async function traderSummaries(db: Db, viewer: Viewer | null, users: UserRow[]) {
  const ids = users.map((u) => u.id);
  if (!ids.length) return [];
  const [counts, settings, follows] = await Promise.all([
    countsFor(db, users),
    db
      .select({ userId: t.userSettings.userId, interests: t.userSettings.interests, privatePositions: t.userSettings.privateOpenPositions })
      .from(t.userSettings)
      .where(inArray(t.userSettings.userId, ids)),
    viewer
      ? db
          .select({ id: t.follows.followeeId, notify: t.follows.notify })
          .from(t.follows)
          .where(and(eq(t.follows.followerId, viewer.userId), inArray(t.follows.followeeId, ids)))
      : Promise.resolve([]),
  ]);
  const settingsOf = new Map(settings.map((s) => [s.userId, s]));
  const followOf = new Map(follows.map((f) => [f.id, f]));
  return users.map((u) => ({
    id: u.id,
    handle: u.handle,
    name: u.displayName,
    initials: u.initials,
    color: u.color,
    avatarUrl: u.avatarUrl ?? defaultAvatar(u.id),
    bio: u.bio,
    focus: u.focus,
    interests: settingsOf.get(u.id)?.interests ?? [],
    joined: joinedLabel(u.createdAt),
    ...counts.get(u.id)!,
    privatePositions: settingsOf.get(u.id)?.privatePositions ?? false,
    isYou: viewer?.userId === u.id,
    viewer:
      viewer && viewer.userId !== u.id
        ? { following: followOf.has(u.id), notify: followOf.get(u.id)?.notify ?? false }
        : null,
  }));
}

export type TraderSummary = Awaited<ReturnType<typeof traderSummaries>>[number];

const visible = and(isNull(t.users.deletedAt), eq(t.users.status, "active"));

export async function listTraders(
  db: Db,
  viewer: Viewer | null,
  query: { q?: string; category?: string; suggested?: boolean; limit?: number },
) {
  const limit = Math.min(query.limit ?? 20, 50);
  const followed = viewer
    ? db.select({ id: t.follows.followeeId }).from(t.follows).where(eq(t.follows.followerId, viewer.userId))
    : undefined;
  const rows = await db
    .select({ user: t.users })
    .from(t.users)
    .leftJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .where(
      and(
        visible,
        query.q
          ? or(ilike(t.users.handle, `%${query.q.replace(/[%_]/g, "")}%`), ilike(t.users.displayName, `%${query.q.replace(/[%_]/g, "")}%`))
          : undefined,
        query.category ? sql`${query.category} = any(${t.userSettings.interests})` : undefined,
        // Suggestions leave out you and the people you already follow.
        query.suggested && viewer ? ne(t.users.id, viewer.userId) : undefined,
        query.suggested && followed ? notInArray(t.users.id, followed) : undefined,
      ),
    )
    .orderBy(desc(t.users.followersCount), t.users.createdAt)
    .limit(limit);
  return { items: await traderSummaries(db, viewer, rows.map((r) => r.user)) };
}

async function userByHandle(db: Db, handle: string) {
  const [user] = await db
    .select()
    .from(t.users)
    .where(and(sql`lower(${t.users.handle}) = lower(${handle})`, visible))
    .limit(1);
  if (!user) throw notFound("That trader");
  return user;
}

/** A trader's page: who they are, their track record, and what they hold
    (open positions only when they share them, or it's you). */
export async function getTrader(db: Db, viewer: Viewer | null, handle: string) {
  const user = await userByHandle(db, handle);
  const [summary] = await traderSummaries(db, viewer, [user]);
  const stats = await db.select().from(t.traderStats).where(eq(t.traderStats.userId, user.id));
  const period = (p: (typeof t.STAT_PERIODS)[number]) => {
    const row = stats.find((s) => s.period === p && s.category === "All");
    return {
      returnPct: row?.returnPct ?? 0,
      correct: row?.correct ?? 0,
      resolved: row?.resolved ?? 0,
      trades: row?.trades ?? 0,
      pnlCents: cents(row?.pnl ?? 0),
      startingCapitalCents: cents(row?.startingCapital ?? 0),
    };
  };
  const all = stats.find((s) => s.period === "All" && s.category === "All");
  const categories = Object.fromEntries(
    stats
      .filter((s) => s.period === "All" && s.category !== "All")
      .map((s) => [s.category, { correct: s.correct, resolved: s.resolved }]),
  );
  const thirty = stats.find((s) => s.period === "30D" && s.category === "All");
  /** Cumulative P&L by day for each period, as the stats job last drew it. */
  const curves = Object.fromEntries(
    stats
      .filter((s) => s.category === "All" && s.curve?.length)
      .map((s) => [s.period, s.curve!.map((v) => cents(v))]),
  ) as Partial<Record<(typeof t.STAT_PERIODS)[number], number[]>>;

  const showOpen = !summary.privatePositions || summary.isYou;
  const [account] = await db
    .select({ id: t.tradingAccounts.id })
    .from(t.tradingAccounts)
    .where(eq(t.tradingAccounts.userId, user.id))
    .limit(1);
  const open = account && showOpen
    ? await db
        .select({ p: t.positions, slug: t.markets.slug, scale: t.markets.quantityScale })
        .from(t.positions)
        .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
        .where(eq(t.positions.accountId, account.id))
    : [];
  const closed = account
    ? await db
        .select({ r: t.realizedPnl, slug: t.markets.slug, scale: t.markets.quantityScale })
        .from(t.realizedPnl)
        .innerJoin(t.markets, eq(t.markets.id, t.realizedPnl.marketId))
        .where(eq(t.realizedPnl.accountId, account.id))
        .orderBy(desc(t.realizedPnl.closedAt))
        .limit(100)
    : [];
  // Rooms they belong to that you can see: public ones, and yours.
  const memberships = await db
    .select({ slug: t.rooms.slug })
    .from(t.roomMembers)
    .innerJoin(t.rooms, eq(t.rooms.id, t.roomMembers.roomId))
    .where(
      and(
        eq(t.roomMembers.userId, user.id),
        isNull(t.rooms.archivedAt),
        viewer
          ? or(eq(t.rooms.privacy, "public"), sql`exists (select 1 from room_members mine where mine.room_id = ${t.rooms.id} and mine.user_id = ${viewer.userId})`)
          : eq(t.rooms.privacy, "public"),
      ),
    );
  const perShare = (amount: number, quantity: number, scale: number) =>
    quantity ? cents(Math.round((amount * 10 ** scale) / quantity)) : 0;
  const outcome = (key: string) => (key === "yes" ? ("Yes" as const) : ("No" as const));
  return {
    ...summary,
    curve30: thirty?.curve?.map((v) => cents(v)),
    curves,
    /** Place on the 30-day P&L board, when they're on it. */
    rank30: await boardRank(db, user.id),
    record: all?.record ?? null,
    stats: { "7D": period("7D"), "30D": period("30D"), "90D": period("90D"), All: period("All") },
    categories,
    history: [
      ...open.map(({ p, slug, scale }) => ({
        marketId: slug,
        outcome: outcome(p.outcome),
        shares: p.quantity / 10 ** scale,
        entryPrice: perShare(p.cost, p.quantity, scale),
        feeCents: cents(p.fees),
      })),
      ...closed.map(({ r, slug, scale }) => ({
        marketId: slug,
        outcome: outcome(r.outcome),
        shares: r.quantity / 10 ** scale,
        entryPrice: perShare(r.cost, r.quantity, scale),
        exitPrice: perShare(r.proceeds, r.quantity, scale),
        feeCents: cents(r.entryFees + r.exitFees),
      })),
    ],
    openPositionsHidden: !showOpen,
    roomIds: memberships.map((m) => m.slug),
  };
}

/** Who follows them, newest first. */
export async function listFollowers(db: Db, viewer: Viewer | null, handle: string, options: { before?: string; limit?: number } = {}) {
  const user = await userByHandle(db, handle);
  return followPage(db, viewer, eq(t.follows.followeeId, user.id), t.follows.followerId, options);
}

/** Who they follow, newest first. */
export async function listFollowingOf(db: Db, viewer: Viewer | null, handle: string, options: { before?: string; limit?: number } = {}) {
  const user = await userByHandle(db, handle);
  return followPage(db, viewer, eq(t.follows.followerId, user.id), t.follows.followeeId, options);
}

async function followPage(
  db: Db,
  viewer: Viewer | null,
  where: ReturnType<typeof eq>,
  person: typeof t.follows.followerId | typeof t.follows.followeeId,
  options: { before?: string; limit?: number },
) {
  const limit = Math.min(options.limit ?? 50, 100);
  const rows = await db
    .select({ user: t.users, at: t.follows.createdAt })
    .from(t.follows)
    .innerJoin(t.users, eq(t.users.id, person))
    .where(and(where, visible, options.before ? sql`${t.follows.createdAt} < ${options.before}::timestamptz` : undefined))
    .orderBy(desc(t.follows.createdAt), desc(t.users.followersCount))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: await traderSummaries(db, viewer, page.map((r) => r.user)),
    next: rows.length > limit ? page.at(-1)!.at.toISOString() : undefined,
  };
}

export async function follow(db: Db, viewer: Viewer, handle: string, options: { notify?: boolean } = {}) {
  const user = await userByHandle(db, handle);
  if (user.id === viewer.userId) throw invalid("You can't follow yourself.");
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(t.follows)
      .values({ followerId: viewer.userId, followeeId: user.id, notify: options.notify ?? false })
      .onConflictDoNothing()
      .returning({ at: t.follows.createdAt });
    if (options.notify !== undefined && !inserted.length)
      await tx
        .update(t.follows)
        .set({ notify: options.notify })
        .where(and(eq(t.follows.followerId, viewer.userId), eq(t.follows.followeeId, user.id)));
    if (inserted.length) {
      await bumpCounts(tx, viewer.userId, user.id, 1);
      await appendEvent(tx, "follow.created", `user:${user.id}`, {
        followerId: viewer.userId,
        followeeId: user.id,
      });
    }
  });
  return summaryOf(db, viewer, user.id);
}

async function bumpCounts(tx: Tx, followerId: string, followeeId: string, by: 1 | -1) {
  await tx
    .update(t.users)
    .set({ followersCount: sql`greatest(0, ${t.users.followersCount} + ${by})` })
    .where(eq(t.users.id, followeeId));
  await tx
    .update(t.users)
    .set({ followingCount: sql`greatest(0, ${t.users.followingCount} + ${by})` })
    .where(eq(t.users.id, followerId));
}

/** A fresh read of one person, counters included. */
async function summaryOf(db: Db, viewer: Viewer | null, id: string) {
  const [user] = await db.select().from(t.users).where(eq(t.users.id, id));
  const [summary] = await traderSummaries(db, viewer, [user]);
  return summary;
}

export async function unfollow(db: Db, viewer: Viewer, handle: string) {
  const user = await userByHandle(db, handle);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(t.follows)
      .where(and(eq(t.follows.followerId, viewer.userId), eq(t.follows.followeeId, user.id)))
      .returning({ at: t.follows.createdAt });
    if (removed.length) await bumpCounts(tx, viewer.userId, user.id, -1);
  });
  return summaryOf(db, viewer, user.id);
}

/** The bell: be told when they post. Ringing it follows them too. */
export async function setBell(db: Db, viewer: Viewer, handle: string, on: boolean) {
  if (on) return follow(db, viewer, handle, { notify: true });
  const user = await userByHandle(db, handle);
  await db
    .update(t.follows)
    .set({ notify: false })
    .where(and(eq(t.follows.followerId, viewer.userId), eq(t.follows.followeeId, user.id)));
  return summaryOf(db, viewer, user.id);
}

export async function listFollowing(db: Db, viewer: Viewer) {
  const rows = await db
    .select({ user: t.users, notify: t.follows.notify })
    .from(t.follows)
    .innerJoin(t.users, eq(t.users.id, t.follows.followeeId))
    .where(and(eq(t.follows.followerId, viewer.userId), visible))
    .orderBy(desc(t.follows.createdAt));
  return { items: await traderSummaries(db, viewer, rows.map((r) => r.user)) };
}

export interface ProfilePatch {
  displayName?: string;
  handle?: string;
  bio?: string;
  focus?: string;
  region?: string;
  avatarKey?: string | null;
  avatarPreset?: AvatarPreset;
  theme?: "Midnight" | "Dim" | "System";
  priceInCents?: boolean;
  showPositionsOnPosts?: boolean;
  appearOnLeaderboard?: boolean;
  privateOpenPositions?: boolean;
  interests?: string[];
  onboarded?: boolean;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
    .padEnd(2, "·")
    .slice(0, 2);

/** The storage key behind one of our public URLs, or null (an illustration, or a Google photo from before). */
export function storedKey(storage: Pick<Deps["storage"], "publicUrl">, url: string) {
  const base = storage.publicUrl("");
  return url.startsWith(base) && url.length > base.length ? url.slice(base.length) : null;
}

export async function updateProfile(
  deps: Pick<Deps, "storage" | "jobs">,
  db: Db,
  viewer: Viewer,
  patch: ProfilePatch,
) {
  const { displayName, handle, bio, focus, region, avatarKey, avatarPreset, ...settings } = patch;
  if (avatarKey !== undefined && avatarPreset !== undefined) throw invalid("Choose a photo or an illustration, not both.");
  // Theirs, uploaded, and really an image of an allowed size.
  if (avatarKey) await checkUpload(deps, viewer, "avatar", avatarKey);
  let replaced: string | null = null;
  await db.transaction(async (tx) => {
    if (avatarKey !== undefined || avatarPreset !== undefined) {
      const [current] = await tx.select({ avatarUrl: t.users.avatarUrl }).from(t.users).where(eq(t.users.id, viewer.userId));
      const key = current?.avatarUrl ? storedKey(deps.storage, current.avatarUrl) : null;
      if (key && key !== avatarKey && key.startsWith(`avatars/${viewer.userId}/`)) replaced = key;
    }
    if (handle !== undefined && handle.toLowerCase() !== viewer.handle.toLowerCase()) {
      if (isReservedHandle(handle)) throw invalid("That handle is reserved.");
      const [taken] = await tx
        .select({ id: t.users.id })
        .from(t.users)
        .where(and(sql`lower(${t.users.handle}) = lower(${handle})`, ne(t.users.id, viewer.userId)))
        .limit(1);
      if (taken) throw conflict("handle_taken", "That handle is taken.");
    }
    const user: Partial<typeof t.users.$inferInsert> = {
      ...(displayName !== undefined && { displayName, initials: initialsOf(displayName) }),
      ...(handle !== undefined && { handle }),
      ...(bio !== undefined && { bio }),
      ...(focus !== undefined && { focus }),
      ...(region !== undefined && { region }),
      // No photo means the illustrated avatar they were given.
      ...(avatarKey !== undefined && { avatarUrl: avatarKey ? deps.storage.publicUrl(avatarKey) : null }),
      ...(avatarPreset !== undefined && { avatarUrl: presetUrl(avatarPreset) }),
    };
    if (Object.keys(user).length)
      await tx.update(t.users).set(user).where(eq(t.users.id, viewer.userId)).catch((error: unknown) => {
        // Two people claiming one handle at once: the index decides.
        if ((error as { cause?: { code?: string } }).cause?.code === "23505")
          throw conflict("handle_taken", "That handle is taken.");
        throw error;
      });
    if (Object.keys(settings).length)
      await tx.update(t.userSettings).set(settings).where(eq(t.userSettings.userId, viewer.userId));
  });
  // A photo they replaced or removed goes from storage too, not just the page.
  if (replaced) await deps.jobs.enqueue("storage.delete", { key: replaced }, { key: `storage.delete:${replaced}` });
}

export async function notificationPreferences(db: Db, viewer: Viewer) {
  const rows = await db
    .select()
    .from(t.notificationPrefs)
    .where(eq(t.notificationPrefs.userId, viewer.userId));
  const own = new Map(rows.map((r) => [r.kind, r]));
  return {
    items: NOTIFICATION_PREFERENCES.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      app: p.locked ? true : (own.get(p.id)?.app ?? p.app),
      email: own.get(p.id)?.email ?? p.email,
      ...(p.locked && { locked: true }),
    })),
  };
}

export async function setNotificationPreference(
  db: Db,
  viewer: Viewer,
  id: string,
  change: { app?: boolean; email?: boolean },
) {
  const definition = NOTIFICATION_PREFERENCES.find((p) => p.id === id);
  if (!definition) throw notFound("That notification setting");
  if (definition.locked && change.app === false)
    throw invalid("This one stays on for your safety.");
  await db
    .insert(t.notificationPrefs)
    .values({
      userId: viewer.userId,
      kind: id,
      app: change.app ?? definition.app,
      email: change.email ?? definition.email,
    })
    .onConflictDoUpdate({
      target: [t.notificationPrefs.userId, t.notificationPrefs.kind],
      set: {
        ...(change.app !== undefined && { app: change.app }),
        ...(change.email !== undefined && { email: change.email }),
      },
    });
  return notificationPreferences(db, viewer);
}

const VERIFY = "verify-email";

/** A new address, unverified until its owner follows the link we mail. */
export async function changeEmail(
  deps: Pick<Deps, "config" | "profile" | "clock" | "jobs">,
  db: Db,
  viewer: Viewer,
  email: string,
) {
  const now = deps.clock.now();
  await db
    .update(t.userSettings)
    .set({ email, emailVerifiedAt: null })
    .where(eq(t.userSettings.userId, viewer.userId));
  const token = signToken(tokenSecret(deps), VERIFY, { userId: viewer.userId, email }, new Date(now.getTime() + 48 * 3_600_000));
  await deps.jobs.enqueue(
    "mail.send",
    {
      template: "verify-email",
      to: email,
      data: { name: viewer.displayName, link: `${deps.config.APP_URL}/api/v1/email/verify?token=${token}` },
      idempotencyKey: `verify:${viewer.userId}:${email}:${Math.floor(now.getTime() / 60_000)}`,
    },
    { key: `verify:${viewer.userId}` },
  );
  return { email, verified: false };
}

export async function verifyEmail(
  deps: Pick<Deps, "config" | "profile" | "clock">,
  db: Db,
  token: string,
) {
  const payload = readToken(tokenSecret(deps), VERIFY, token, deps.clock.now());
  if (!payload) throw invalid("That link has expired or isn't valid.");
  const updated = await db
    .update(t.userSettings)
    .set({ emailVerifiedAt: deps.clock.now() })
    .where(and(eq(t.userSettings.userId, payload.userId), eq(t.userSettings.email, payload.email)))
    .returning({ userId: t.userSettings.userId });
  // The address changed again since the link was sent: this one no longer counts.
  if (!updated.length) throw invalid("That link is for an address you've since changed.");
  return { email: payload.email, verified: true };
}

/** Where someone stands on the leaderboard's default view (30 days, P&L,
    the resolved-count floor), ordered exactly as the board orders it; null
    when they aren't on it. */
async function boardRank(db: Db, userId: string) {
  const eligible = and(
    eq(t.traderStats.period, "30D"),
    eq(t.traderStats.category, "All"),
    eq(t.userSettings.appearOnLeaderboard, true),
    isNull(t.users.deletedAt),
    eq(t.users.status, "active"),
    gte(t.traderStats.resolved, MIN_SAMPLE),
  );
  const board = () =>
    db
      .select({ ahead: sql<number>`count(*)::int` })
      .from(t.traderStats)
      .innerJoin(t.users, eq(t.users.id, t.traderStats.userId))
      .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id));
  const [mine] = await db
    .select({ pnl: t.traderStats.pnl })
    .from(t.traderStats)
    .innerJoin(t.users, eq(t.users.id, t.traderStats.userId))
    .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .where(and(eligible, eq(t.traderStats.userId, userId)));
  if (!mine) return null;
  const [{ ahead }] = await board().where(
    and(
      eligible,
      or(
        gt(t.traderStats.pnl, mine.pnl),
        and(eq(t.traderStats.pnl, mine.pnl), lt(t.users.id, userId)),
      ),
    ),
  );
  return ahead + 1;
}
