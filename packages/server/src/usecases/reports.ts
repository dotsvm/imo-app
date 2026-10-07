/**
 * Reports and the moderation queue. People flag a prediction, comment,
 * message, person or room; moderators dismiss it, remove the content, or
 * suspend its author. Every report on the same thing resolves together.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import type { Db, Queryable } from "../db/client";
import * as t from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { audit } from "./admin";
import type { Viewer } from "./viewer";

export const REPORT_REASONS = ["spam", "harassment", "misleading", "impersonation", "other"] as const;
type Subject = (typeof t.reports.$inferSelect)["subjectType"];

/** The subject's author (or owner) and a line to show moderators. */
async function describe(q: Queryable, type: Subject, id: string) {
  switch (type) {
    case "post": {
      const [row] = await q.select({ author: t.posts.authorId, text: t.posts.text, gone: t.posts.deletedAt }).from(t.posts).where(eq(t.posts.id, id));
      return row && { author: row.author, preview: row.text, removed: !!row.gone };
    }
    case "comment": {
      const [row] = await q.select({ author: t.comments.authorId, text: t.comments.text, gone: t.comments.deletedAt }).from(t.comments).where(eq(t.comments.id, id));
      return row && { author: row.author, preview: row.text, removed: !!row.gone };
    }
    case "message": {
      const [row] = await q
        .select({ author: t.roomMessages.authorId, text: t.roomMessages.text, gone: t.roomMessages.deletedAt })
        .from(t.roomMessages)
        .where(eq(t.roomMessages.id, id));
      return row && { author: row.author, preview: row.text, removed: !!row.gone };
    }
    case "user": {
      const [row] = await q.select({ id: t.users.id, bio: t.users.bio, handle: t.users.handle, status: t.users.status }).from(t.users).where(eq(t.users.id, id));
      return row && { author: row.id, preview: `@${row.handle}: ${row.bio}`, removed: row.status === "suspended" };
    }
    case "room": {
      const [row] = await q.select({ owner: t.rooms.ownerId, name: t.rooms.name, description: t.rooms.description, gone: t.rooms.archivedAt }).from(t.rooms).where(eq(t.rooms.id, id));
      return row && { author: row.owner, preview: `${row.name}: ${row.description}`, removed: !!row.gone };
    }
  }
}

export async function fileReport(
  deps: Pick<Deps, "clock">,
  db: Db,
  viewer: Viewer,
  input: { subjectType: Subject; subjectId: string; reason: (typeof REPORT_REASONS)[number]; note?: string },
) {
  const subject = await describe(db, input.subjectType, input.subjectId);
  if (!subject) throw notFound("That");
  if (subject.author === viewer.userId) throw invalid("You can't report yourself.");
  const [open] = await db
    .select({ id: t.reports.id })
    .from(t.reports)
    .where(
      and(
        eq(t.reports.reporterId, viewer.userId),
        eq(t.reports.subjectType, input.subjectType),
        eq(t.reports.subjectId, input.subjectId),
        eq(t.reports.status, "open"),
      ),
    );
  if (open) return { id: open.id, received: true };
  const [row] = await db
    .insert(t.reports)
    .values({
      reporterId: viewer.userId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.note ? `${input.reason}: ${input.note}` : input.reason,
      createdAt: deps.clock.now(),
    })
    .returning({ id: t.reports.id });
  return { id: row.id, received: true };
}

/** Open reports, one row per reported thing, most-reported first. */
export async function moderationQueue(db: Db, status: "open" | "actioned" | "dismissed") {
  const rows = await db
    .select({
      subjectType: t.reports.subjectType,
      subjectId: t.reports.subjectId,
      reports: sql<number>`count(*)::int`,
      reasons: sql<string[]>`array_agg(distinct ${t.reports.reason})`,
      first: sql<Date>`min(${t.reports.createdAt})`,
      ids: sql<string[]>`array_agg(${t.reports.id})`,
    })
    .from(t.reports)
    .where(eq(t.reports.status, status))
    .groupBy(t.reports.subjectType, t.reports.subjectId)
    .orderBy(desc(sql`count(*)`), sql`min(${t.reports.createdAt})`)
    .limit(200);
  const items = [];
  for (const r of rows) {
    const subject = await describe(db, r.subjectType, r.subjectId);
    const [author] = subject
      ? await db.select({ handle: t.users.handle, name: t.users.displayName, status: t.users.status }).from(t.users).where(eq(t.users.id, subject.author))
      : [];
    items.push({
      id: r.ids[0],
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      reports: r.reports,
      reasons: r.reasons,
      firstReportedAt: new Date(r.first).toISOString(),
      preview: subject?.preview ?? null,
      removed: subject?.removed ?? true,
      author: author ?? null,
    });
  }
  return { items };
}

export async function resolveReport(
  deps: Pick<Deps, "clock">,
  db: Db,
  actor: Viewer,
  reportId: string,
  action: "dismiss" | "remove" | "suspend",
) {
  const now = deps.clock.now();
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(t.reports).where(eq(t.reports.id, reportId));
    if (!report) throw notFound("That report");
    if (report.status !== "open") throw conflict("already_resolved", "Someone already handled this report.");
    const subject = await describe(tx, report.subjectType, report.subjectId);
    if (action !== "dismiss" && subject) {
      const id = report.subjectId;
      if (action === "remove" || report.subjectType !== "user") {
        if (report.subjectType === "post") await tx.update(t.posts).set({ deletedAt: now }).where(and(eq(t.posts.id, id), isNull(t.posts.deletedAt)));
        if (report.subjectType === "comment")
          await tx.update(t.comments).set({ deletedAt: now }).where(and(eq(t.comments.id, id), isNull(t.comments.deletedAt)));
        if (report.subjectType === "message")
          await tx.update(t.roomMessages).set({ deletedAt: now }).where(and(eq(t.roomMessages.id, id), isNull(t.roomMessages.deletedAt)));
        if (report.subjectType === "room") await tx.update(t.rooms).set({ archivedAt: now }).where(and(eq(t.rooms.id, id), isNull(t.rooms.archivedAt)));
      }
      if (action === "suspend" || report.subjectType === "user")
        await tx.update(t.users).set({ status: "suspended" }).where(eq(t.users.id, subject.author));
    }
    const resolved = await tx
      .update(t.reports)
      .set({ status: action === "dismiss" ? "dismissed" : "actioned", resolverId: actor.userId, resolvedAt: now })
      .where(and(eq(t.reports.subjectType, report.subjectType), eq(t.reports.subjectId, report.subjectId), eq(t.reports.status, "open")))
      .returning({ id: t.reports.id });
    await audit(tx, actor, `report.${action}`, `${report.subjectType}:${report.subjectId}`, { reports: resolved.length });
    return { resolved: resolved.length, action };
  });
}

