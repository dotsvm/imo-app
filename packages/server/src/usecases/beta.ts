/**
 * The private beta: invite codes, the waitlist, and letting people in.
 * Members can pass on a few single-use invites; admins issue more and invite
 * from the waitlist by email.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { BETA_GATE, type Deps } from "../composition";
import type { Db, Queryable } from "../db/client";
import * as t from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { appendEvent } from "../outbox";
import type { Viewer } from "./viewer";

export const MEMBER_INVITES = 3;
const INVITE_DAYS = 30;
/** No 0/O, 1/I/L: codes get read aloud and typed from screenshots. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function inviteCode() {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

const normalize = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

const view = (row: typeof t.invites.$inferSelect) => ({
  code: row.code,
  uses: row.uses,
  maxUses: row.maxUses,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  revoked: !!row.revokedAt,
  email: row.email,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

export async function createInvites(
  q: Queryable,
  input: { createdBy: string | null; count: number; maxUses: number; expiresAt: Date | null; note?: string; email?: string; now: Date },
) {
  const rows: (typeof t.invites.$inferSelect)[] = [];
  while (rows.length < input.count) {
    const [row] = await q
      .insert(t.invites)
      .values({
        code: inviteCode(),
        createdBy: input.createdBy,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
        note: input.note ?? null,
        email: input.email ?? null,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    if (row) rows.push(row); // a collision just draws again
  }
  return rows.map(view);
}

export async function myInvites(db: Db, viewer: Viewer) {
  const rows = await db.select().from(t.invites).where(eq(t.invites.createdBy, viewer.userId)).orderBy(desc(t.invites.createdAt));
  return { items: rows.map(view), remaining: Math.max(0, MEMBER_INVITES - rows.length) };
}

/** A single-use code to pass on; each member gets a few. */
export async function createMyInvite(deps: Pick<Deps, "clock">, db: Db, viewer: Viewer) {
  const now = deps.clock.now();
  return db.transaction(async (tx) => {
    // Serialize one person's requests so the allowance holds.
    await tx.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, viewer.userId)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.invites).where(eq(t.invites.createdBy, viewer.userId));
    if (n >= MEMBER_INVITES) throw invalid(`You've shared all ${MEMBER_INVITES} of your invites.`);
    const [invite] = await createInvites(tx, {
      createdBy: viewer.userId,
      count: 1,
      maxUses: 1,
      expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
      now,
    });
    return invite;
  });
}

/** Use a code: you're in. Using one when you're already in costs nothing. */
export async function redeemInvite(deps: Pick<Deps, "clock">, db: Db, viewer: Viewer, raw: string) {
  const code = normalize(raw);
  const now = deps.clock.now();
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ granted: t.users.accessGrantedAt }).from(t.users).where(eq(t.users.id, viewer.userId)).for("update");
    if (user?.granted) return { granted: true, already: true };
    const [invite] = await tx.select().from(t.invites).where(eq(t.invites.code, code)).for("update");
    if (!invite || invite.revokedAt) throw notFound("That invite code");
    if (invite.expiresAt && invite.expiresAt <= now) throw conflict("invite_expired", "That invite has expired.");
    if (invite.uses >= invite.maxUses) throw conflict("invite_used", "That invite has been used.");
    await tx.update(t.invites).set({ uses: invite.uses + 1 }).where(eq(t.invites.code, code));
    await tx.insert(t.inviteRedemptions).values({ code, userId: viewer.userId, createdAt: now });
    await tx.update(t.users).set({ accessGrantedAt: now }).where(eq(t.users.id, viewer.userId));
    await appendEvent(tx, "beta.granted", `user:${viewer.userId}`, {
      userId: viewer.userId,
      code,
      invitedBy: invite.createdBy,
    });
    return { granted: true, already: false };
  });
}

/** On the list; saying whether someone's on it would leak who signed up. */
export async function joinWaitlist(deps: Pick<Deps, "clock">, db: Db, email: string, note?: string) {
  await db
    .insert(t.waitlist)
    .values({ email: email.trim().toLowerCase(), note: note ?? null, createdAt: deps.clock.now() })
    .onConflictDoNothing();
  return { joined: true };
}

/** Codes that can still be used. */
export const usable = (now: Date) =>
  and(isNull(t.invites.revokedAt), sql`${t.invites.uses} < ${t.invites.maxUses}`, or(isNull(t.invites.expiresAt), gt(t.invites.expiresAt, now)));

/** Where someone stands with the beta, for the welcome screen. */
export async function betaStatus(deps: Pick<Deps, "flags">, viewer: Viewer) {
  return { gated: await deps.flags.enabled(BETA_GATE), granted: viewer.accessGranted };
}
