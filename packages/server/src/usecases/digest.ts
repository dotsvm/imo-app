/**
 * The daily digest: predictions from the traders you follow, once a day by
 * email, for people who asked for it and confirmed their address. Every
 * notification email carries a one-click unsubscribe for its kind.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, lt, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import type { MailMessage } from "@imo/core/ports/platform";
import { NOTIFICATION_PREFERENCES } from "../catalogs";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { readToken, signToken, tokenSecret } from "../tokens";

/** Digests go out at 13:00 UTC (9am in New York). */
export const DIGEST_HOUR_UTC = 13;
const UNSUBSCRIBE = "unsubscribe";
const YEAR = 365 * 86_400_000;

type TokenDeps = Pick<Deps, "config" | "profile" | "clock">;

export function unsubscribeUrl(deps: TokenDeps, userId: string, kind: string) {
  const token = signToken(tokenSecret(deps), UNSUBSCRIBE, { userId, kind }, new Date(deps.clock.now().getTime() + YEAR));
  return `${deps.config.APP_URL.replace(/\/+$/, "")}/api/v1/email/unsubscribe?token=${token}`;
}

/** Turn off one kind of email, from the link in it. */
export async function unsubscribe(deps: TokenDeps, db: Db, token: string) {
  const payload = readToken(tokenSecret(deps), UNSUBSCRIBE, token, deps.clock.now());
  if (!payload || !NOTIFICATION_PREFERENCES.some((p) => p.id === payload.kind)) return null;
  const definition = NOTIFICATION_PREFERENCES.find((p) => p.id === payload.kind)!;
  await db
    .insert(t.notificationPrefs)
    .values({ userId: payload.userId, kind: payload.kind, app: definition.app, email: false })
    .onConflictDoUpdate({ target: [t.notificationPrefs.userId, t.notificationPrefs.kind], set: { email: false } });
  return payload.kind;
}

const snippet = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Everyone whose digest is due, with what goes in it; marks them sent. */
export async function dueDigests(deps: TokenDeps, db: Db): Promise<MailMessage[]> {
  const now = deps.clock.now();
  if (now.getUTCHours() !== DIGEST_HOUR_UTC) return [];
  const since = new Date(now.getTime() - 86_400_000);
  const people = await db
    .select({ userId: t.users.id, name: t.users.displayName, email: t.userSettings.email })
    .from(t.users)
    .innerJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .innerJoin(t.notificationPrefs, and(eq(t.notificationPrefs.userId, t.users.id), eq(t.notificationPrefs.kind, "digest")))
    .where(
      and(
        eq(t.notificationPrefs.email, true),
        isNotNull(t.userSettings.email),
        isNotNull(t.userSettings.emailVerifiedAt),
        eq(t.users.status, "active"),
        eq(t.users.isDemo, false),
        isNull(t.users.deletedAt),
        or(isNull(t.userSettings.lastDigestAt), lt(t.userSettings.lastDigestAt, new Date(now.getTime() - 20 * 3_600_000))),
      ),
    )
    .limit(1_000);
  const messages: MailMessage[] = [];
  for (const person of people) {
    const posts = await db
      .select({ post: t.posts, author: t.users.displayName, market: t.markets.shortTitle })
      .from(t.posts)
      .innerJoin(t.users, eq(t.users.id, t.posts.authorId))
      .innerJoin(t.markets, eq(t.markets.id, t.posts.marketId))
      .where(
        and(
          inArray(t.posts.authorId, db.select({ id: t.follows.followeeId }).from(t.follows).where(eq(t.follows.followerId, person.userId))),
          isNull(t.posts.roomId),
          isNull(t.posts.deletedAt),
          gt(t.posts.createdAt, since),
        ),
      )
      .orderBy(desc(sql`${t.posts.likes} + 2 * ${t.posts.backed}`), desc(t.posts.createdAt))
      .limit(20);
    if (!posts.length) continue;
    const shown = posts.slice(0, 6);
    await db.update(t.userSettings).set({ lastDigestAt: now }).where(eq(t.userSettings.userId, person.userId));
    messages.push({
      template: "digest",
      to: person.email!,
      data: {
        name: person.name,
        items: shown.map(({ post, author, market }) => ({
          author,
          market,
          outcome: post.outcome === "yes" ? "Yes" : "No",
          entryCents: Math.round(cents(post.entryPrice)),
          snippet: snippet(post.text),
          href: `/post/${post.id}`,
        })),
        more: posts.length - shown.length,
      },
      idempotencyKey: `digest:${person.userId}:${now.toISOString().slice(0, 10)}`,
      unsubscribeUrl: unsubscribeUrl(deps, person.userId, "digest"),
    });
  }
  return messages;
}
