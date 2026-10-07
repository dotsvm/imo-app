/**
 * Running the beta: flags, invites and the waitlist, people, markets and
 * venues, moderation, jobs — and an audit line for every change, naming who
 * made it.
 */
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import type { Db, Queryable } from "../db/client";
import * as t from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { createInvites, usable } from "./beta";
import { traderSummaries } from "./people";
import type { Viewer } from "./viewer";

export async function audit(q: Queryable, actor: Viewer, action: string, subject: string, data?: Record<string, unknown>) {
  await q.insert(t.auditLog).values({ actorId: actor.userId, action, subject, data: data ?? null });
}

export async function overview(db: Db, now: Date) {
  const [[users], [granted], [waiting], [reports], [pendingJobs], [deadJobs], [backlog], markets, venues, leases] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(t.users).where(isNull(t.users.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(t.users).where(isNotNull(t.users.accessGrantedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(t.waitlist).where(isNull(t.waitlist.invitedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(t.reports).where(eq(t.reports.status, "open")),
    db.select({ n: sql<number>`count(*)::int` }).from(t.jobs).where(eq(t.jobs.status, "pending")),
    db.select({ n: sql<number>`count(*)::int` }).from(t.jobs).where(eq(t.jobs.status, "dead")),
    db.select({ n: sql<number>`count(*)::int` }).from(t.outbox).where(isNull(t.outbox.processedAt)),
    db
      .select({ source: t.markets.source, status: t.markets.status, n: sql<number>`count(*)::int` })
      .from(t.markets)
      .groupBy(t.markets.source, t.markets.status),
    db.select().from(t.venueStatus),
    db.select().from(t.workerLeases),
  ]);
  return {
    people: { total: users.n, granted: granted.n, waitlist: waiting.n },
    moderation: { openReports: reports.n },
    work: { pendingJobs: pendingJobs.n, deadJobs: deadJobs.n, outboxBacklog: backlog.n },
    markets,
    venues: venues.map((v) => ({ ...v, resumesAt: v.resumesAt?.toISOString() ?? null, checkedAt: v.checkedAt.toISOString() })),
    // Lanes whose lease lapsed are lanes nobody is running.
    lanes: leases.map((l) => ({ lane: l.lane, holder: l.holder, until: l.until.toISOString(), alive: l.until > now })),
  };
}

// ---------------------------------------------------------------- flags
export async function listFlags(db: Db) {
  const rows = await db.select().from(t.flags).orderBy(t.flags.key);
  return { items: rows.map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() })) };
}

export async function setFlag(
  deps: Pick<Deps, "flags">,
  db: Db,
  actor: Viewer,
  key: string,
  input: { enabled: boolean; rules?: (typeof t.flags.$inferInsert)["rules"] },
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(t.flags)
      .values({ key, enabled: input.enabled, rules: input.rules ?? null })
      .onConflictDoUpdate({ target: t.flags.key, set: { enabled: input.enabled, rules: input.rules ?? null } });
    await audit(tx, actor, "flag.set", `flag:${key}`, input);
  });
  deps.flags.invalidate?.();
  return listFlags(db);
}

// -------------------------------------------------------------- invites
export async function listInvites(db: Db, now: Date, activeOnly: boolean) {
  const rows = await db
    .select({ invite: t.invites, by: t.users.handle })
    .from(t.invites)
    .leftJoin(t.users, eq(t.users.id, t.invites.createdBy))
    .where(activeOnly ? usable(now) : undefined)
    .orderBy(desc(t.invites.createdAt))
    .limit(500);
  return {
    items: rows.map(({ invite, by }) => ({
      code: invite.code,
      createdBy: by,
      uses: invite.uses,
      maxUses: invite.maxUses,
      email: invite.email,
      note: invite.note,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      revoked: !!invite.revokedAt,
      createdAt: invite.createdAt.toISOString(),
    })),
  };
}

export async function issueInvites(
  deps: Pick<Deps, "clock">,
  db: Db,
  actor: Viewer,
  input: { count: number; maxUses: number; expiresInDays?: number; note?: string },
) {
  const now = deps.clock.now();
  return db.transaction(async (tx) => {
    const items = await createInvites(tx, {
      createdBy: actor.userId,
      count: input.count,
      maxUses: input.maxUses,
      expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null,
      note: input.note,
      now,
    });
    await audit(tx, actor, "invites.issue", "invites", { count: input.count, maxUses: input.maxUses, note: input.note });
    return { items };
  });
}

export async function revokeInvite(deps: Pick<Deps, "clock">, db: Db, actor: Viewer, code: string) {
  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(t.invites)
      .set({ revokedAt: deps.clock.now() })
      .where(and(eq(t.invites.code, code), isNull(t.invites.revokedAt)))
      .returning({ code: t.invites.code });
    if (!revoked.length) throw notFound("That invite");
    await audit(tx, actor, "invite.revoke", `invite:${code}`);
  });
  return { revoked: true };
}

export async function listWaitlist(db: Db, status: "waiting" | "invited" | "all") {
  const rows = await db
    .select()
    .from(t.waitlist)
    .where(status === "waiting" ? isNull(t.waitlist.invitedAt) : status === "invited" ? isNotNull(t.waitlist.invitedAt) : undefined)
    .orderBy(t.waitlist.createdAt)
    .limit(1_000);
  return {
    items: rows.map((w) => ({ email: w.email, note: w.note, joinedAt: w.createdAt.toISOString(), invitedAt: w.invitedAt?.toISOString() ?? null })),
  };
}

/** A single-use code for each address, mailed to it. */
export async function inviteFromWaitlist(deps: Pick<Deps, "clock" | "jobs">, db: Db, actor: Viewer, emails: string[]) {
  const now = deps.clock.now();
  const sent = await db.transaction(async (tx) => {
    const waiting = await tx
      .select()
      .from(t.waitlist)
      .where(and(inArray(t.waitlist.email, emails.map((e) => e.toLowerCase())), isNull(t.waitlist.invitedAt)))
      .for("update");
    const out: { email: string; code: string }[] = [];
    for (const entry of waiting) {
      const [invite] = await createInvites(tx, {
        createdBy: actor.userId,
        count: 1,
        maxUses: 1,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        email: entry.email,
        note: "Waitlist",
        now,
      });
      await tx.update(t.waitlist).set({ invitedAt: now }).where(eq(t.waitlist.email, entry.email));
      out.push({ email: entry.email, code: invite.code });
    }
    await audit(tx, actor, "waitlist.invite", "waitlist", { emails: out.map((o) => o.email) });
    return out;
  });
  for (const { email, code } of sent)
    await deps.jobs.enqueue(
      "mail.send",
      { template: "invite", to: email, data: { code }, idempotencyKey: `invite:${code}` },
      { key: `invite-mail:${code}` },
    );
  return { invited: sent.length, skipped: emails.length - sent.length };
}

// ---------------------------------------------------------------- people
export async function findPeople(db: Db, actor: Viewer, q: string | undefined) {
  const like = q ? `%${q.replace(/[%_\\]/g, "")}%` : undefined;
  const rows = await db
    .select({ user: t.users, email: t.userSettings.email })
    .from(t.users)
    .leftJoin(t.userSettings, eq(t.userSettings.userId, t.users.id))
    .where(like ? or(ilike(t.users.handle, like), ilike(t.users.displayName, like), ilike(t.userSettings.email, like)) : undefined)
    .orderBy(desc(t.users.createdAt))
    .limit(50);
  const summaries = await traderSummaries(db, actor, rows.map((r) => r.user));
  return {
    items: rows.map((r, i) => ({
      ...summaries[i],
      email: r.email,
      role: r.user.role,
      status: r.user.status,
      demo: r.user.isDemo,
      accessGrantedAt: r.user.accessGrantedAt?.toISOString() ?? null,
    })),
  };
}

async function personBy(q: Queryable, handle: string) {
  const [user] = await q.select().from(t.users).where(sql`lower(${t.users.handle}) = lower(${handle})`);
  if (!user) throw notFound("That person");
  return user;
}

export async function updatePerson(
  deps: Pick<Deps, "clock">,
  db: Db,
  actor: Viewer,
  handle: string,
  change: { access?: boolean; status?: "active" | "suspended"; role?: "user" | "admin" },
) {
  await db.transaction(async (tx) => {
    const user = await personBy(tx, handle);
    if (user.id === actor.userId && (change.role === "user" || change.status === "suspended"))
      throw invalid("You can't demote or suspend yourself.");
    await tx
      .update(t.users)
      .set({
        ...(change.access !== undefined && { accessGrantedAt: change.access ? (user.accessGrantedAt ?? deps.clock.now()) : null }),
        ...(change.status !== undefined && { status: change.status }),
        ...(change.role !== undefined && { role: change.role }),
      })
      .where(eq(t.users.id, user.id));
    await audit(tx, actor, "person.update", `user:${user.id}`, { handle: user.handle, ...change });
  });
  return (await findPeople(db, actor, handle)).items.find((p) => p.handle.toLowerCase() === handle.toLowerCase());
}

// --------------------------------------------------------------- markets
export async function updateMarket(
  db: Db,
  actor: Viewer,
  slug: string,
  change: { category?: string; hidden?: boolean; featured?: boolean; featuredLabel?: string | null },
) {
  return db.transaction(async (tx) => {
    const [market] = await tx
      .update(t.markets)
      .set({
        ...(change.category !== undefined && { category: change.category }),
        ...(change.hidden !== undefined && { hidden: change.hidden }),
        ...(change.featured !== undefined && { featured: change.featured }),
        ...(change.featuredLabel !== undefined && { featuredLabel: change.featuredLabel }),
      })
      .where(eq(t.markets.slug, slug))
      .returning({ slug: t.markets.slug, category: t.markets.category, hidden: t.markets.hidden, featured: t.markets.featured });
    if (!market) throw notFound("That market");
    await audit(tx, actor, "market.update", `market:${slug}`, change);
    return market;
  });
}

export async function categoryMap(db: Db) {
  const rows = await db.select().from(t.categoryMap).orderBy(t.categoryMap.venueId, t.categoryMap.venueCategory);
  return { items: rows };
}

/** Map a venue category onto one of ours (null removes the mapping). Markets
    already ingested keep their category until an admin moves them. */
export async function setCategoryMapping(
  db: Db,
  actor: Viewer,
  input: { venueId: string; venueCategory: string; category: string | null },
) {
  const venueCategory = input.venueCategory.toLowerCase();
  await db.transaction(async (tx) => {
    if (input.category === null)
      await tx
        .delete(t.categoryMap)
        .where(and(eq(t.categoryMap.venueId, input.venueId), eq(t.categoryMap.venueCategory, venueCategory)));
    else
      await tx
        .insert(t.categoryMap)
        .values({ venueId: input.venueId, venueCategory, category: input.category })
        .onConflictDoUpdate({ target: [t.categoryMap.venueId, t.categoryMap.venueCategory], set: { category: input.category } });
    await audit(tx, actor, "category-map.set", `venue:${input.venueId}`, { venueCategory, category: input.category });
  });
  return categoryMap(db);
}

export async function updateVenue(
  db: Db,
  actor: Viewer,
  id: string,
  change: { stage?: (typeof t.ROLLOUT_STAGES)[number]; summary?: string; displayAllowed?: boolean },
) {
  return db.transaction(async (tx) => {
    const [venue] = await tx.update(t.venues).set(change).where(eq(t.venues.id, id)).returning();
    if (!venue) throw notFound("That venue");
    await audit(tx, actor, "venue.update", `venue:${id}`, change);
    return venue;
  });
}

// ------------------------------------------------------------------ jobs
export async function listJobs(db: Db, status: (typeof t.JOB_STATUSES)[number]) {
  const rows = await db.select().from(t.jobs).where(eq(t.jobs.status, status)).orderBy(desc(t.jobs.createdAt)).limit(200);
  return {
    items: rows.map((j) => ({
      id: j.id,
      name: j.name,
      key: j.key,
      attempts: j.attempts,
      lastError: j.lastError,
      runAt: j.runAt.toISOString(),
      createdAt: j.createdAt.toISOString(),
    })),
  };
}

export async function retryJob(deps: Pick<Deps, "clock">, db: Db, actor: Viewer, id: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .update(t.jobs)
      .set({ status: "pending", attempts: 0, runAt: deps.clock.now(), lastError: null, finishedAt: null })
      .where(and(eq(t.jobs.id, id), eq(t.jobs.status, "dead")))
      .returning({ id: t.jobs.id, name: t.jobs.name });
    if (!job) throw conflict("not_dead", "Only dead jobs can be retried.");
    await audit(tx, actor, "job.retry", `job:${id}`, { name: job.name });
    return job;
  });
}

export async function auditTrail(db: Db, query: { subject?: string; limit?: number }) {
  const rows = await db
    .select({ entry: t.auditLog, actor: t.users.handle })
    .from(t.auditLog)
    .leftJoin(t.users, eq(t.users.id, t.auditLog.actorId))
    .where(query.subject ? eq(t.auditLog.subject, query.subject) : undefined)
    .orderBy(desc(t.auditLog.createdAt))
    .limit(Math.min(query.limit ?? 100, 500));
  return {
    items: rows.map(({ entry, actor }) => ({
      id: entry.id,
      actor,
      action: entry.action,
      subject: entry.subject,
      data: entry.data,
      at: entry.createdAt.toISOString(),
    })),
  };
}
