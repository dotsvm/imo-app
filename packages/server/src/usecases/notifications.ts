/**
 * In-app notifications. Written by the outbox relay, one per real-world thing
 * (a dedupe key makes a replayed event harmless), honoring each person's
 * preferences — except the ones that are locked on for safety.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { NOTIFICATION_PREFERENCES } from "../catalogs";
import type { Db, Queryable } from "../db/client";
import * as t from "../db/schema";
import type { Viewer } from "./viewer";

type Row = typeof t.notifications.$inferSelect;

export interface NotificationInput {
  userId: string;
  kind: (typeof t.NOTIFICATION_KINDS)[number];
  /** The preference that governs it (NOTIFICATION_PREFERENCES ids). */
  preference: string;
  icon: string;
  title: string;
  body: string;
  href: string;
  cta?: { label: string; href: string; primary?: boolean };
  dedupeKey: string;
  at?: Date;
}

/** The new notification, or null when it was turned off or already sent. */
export async function notify(
  q: Queryable,
  input: NotificationInput,
): Promise<Row | null> {
  const definition = NOTIFICATION_PREFERENCES.find(
    (p) => p.id === input.preference,
  );
  if (!definition?.locked) {
    const [pref] = await q
      .select({ app: t.notificationPrefs.app })
      .from(t.notificationPrefs)
      .where(
        and(
          eq(t.notificationPrefs.userId, input.userId),
          eq(t.notificationPrefs.kind, input.preference),
        ),
      );
    if (!(pref?.app ?? definition?.app ?? true)) return null;
  }
  const [row] = await q
    .insert(t.notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      icon: input.icon,
      title: input.title,
      body: input.body,
      href: input.href,
      cta: input.cta ?? null,
      dedupeKey: input.dedupeKey,
      ...(input.at && { createdAt: input.at }),
    })
    .onConflictDoNothing({
      target: [t.notifications.userId, t.notifications.dedupeKey],
    })
    .returning();
  return row ?? null;
}

/** The UI's Notification record. */
export const toNotificationDTO = (row: Row) => ({
  id: row.id,
  kind: row.kind,
  icon: row.icon,
  title: row.title,
  body: row.body,
  at: row.createdAt.toISOString(),
  href: row.href,
  read: row.readAt !== null,
  ...(row.cta && { cta: row.cta }),
});

export async function listNotifications(
  db: Db,
  viewer: Viewer,
  options: { before?: string; limit?: number } = {},
) {
  const limit = Math.min(options.limit ?? 30, 100);
  const rows = await db
    .select()
    .from(t.notifications)
    .where(
      and(
        eq(t.notifications.userId, viewer.userId),
        options.before
          ? lt(t.notifications.createdAt, new Date(options.before))
          : undefined,
      ),
    )
    .orderBy(desc(t.notifications.createdAt), desc(t.notifications.id))
    .limit(limit + 1);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(t.notifications)
    .where(
      and(
        eq(t.notifications.userId, viewer.userId),
        isNull(t.notifications.readAt),
      ),
    );
  const page = rows.slice(0, limit);
  return {
    items: page.map(toNotificationDTO),
    unread,
    next:
      rows.length > limit ? page.at(-1)!.createdAt.toISOString() : undefined,
  };
}

export async function markNotificationsRead(
  db: Db,
  viewer: Viewer,
  target: { ids: string[] } | { all: true },
  now: Date,
) {
  const rows = await db
    .update(t.notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(t.notifications.userId, viewer.userId),
        isNull(t.notifications.readAt),
        "ids" in target ? inArray(t.notifications.id, target.ids) : undefined,
      ),
    )
    .returning({ id: t.notifications.id });
  return { read: rows.length };
}
