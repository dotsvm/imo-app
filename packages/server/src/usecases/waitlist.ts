/**
 * The waitlist page: claim a handle before the beta lets you in. Claiming
 * takes a real account (Google or an emailed link), so a handle is held by
 * a person, not typed into a form; your place in line is your earliest
 * signup, and it stays yours when your invite arrives.
 */
import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import { defaultAvatar } from "@imo/core/avatars";
import { FOUNDING_PASSES, REFERRAL_BOOST, SHARE_BOOST, type PassEdition } from "@imo/core/waitlist";
import { HANDLE_PATTERN, isReservedHandle } from "../catalogs";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { conflict, invalid } from "../errors";
import type { Viewer } from "./viewer";

/** Whether a handle could be yours: free, taken, reserved, or already yours. */
export async function handleAvailability(db: Db, viewer: Viewer | null, handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return { handle, available: false, reason: "invalid" as const, yours: false };
  if (viewer && viewer.handle.toLowerCase() === handle.toLowerCase())
    return { handle: viewer.handle, available: true, reason: null, yours: true };
  if (isReservedHandle(handle)) return { handle, available: false, reason: "reserved" as const, yours: false };
  const [taken] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(sql`lower(${t.users.handle}) = lower(${handle})`)
    .limit(1);
  return taken
    ? { handle, available: false, reason: "taken" as const, yours: false }
    : { handle, available: true, reason: null, yours: false };
}

/** Still waiting: on the list, not invited, and not let in some other way. */
const waiting = and(isNull(t.waitlist.invitedAt), or(isNull(t.waitlist.userId), isNull(t.users.accessGrantedAt)));

/** How many people are waiting, how many have ever joined, and how many
    founding passes are left, for the page's counts. */
export async function waitlistSize(db: Db) {
  const [row] = await db
    .select({
      waiting: sql<number>`(count(*) filter (where ${waiting}))::int`,
      joined: sql<number>`count(*)::int`,
    })
    .from(t.waitlist)
    .leftJoin(t.users, eq(t.users.id, t.waitlist.userId));
  const joined = row?.joined ?? 0;
  return { waiting: row?.waiting ?? 0, joined, passesLeft: Math.max(0, FOUNDING_PASSES - joined) };
}

/** The email an account signed in with: where its invite is sent. */
async function accountEmail(db: Db, userId: string) {
  const [row] = await db
    .select({ email: t.authIdentities.email })
    .from(t.authIdentities)
    .where(and(eq(t.authIdentities.userId, userId), isNotNull(t.authIdentities.email)))
    .orderBy(desc(t.authIdentities.createdAt))
    .limit(1);
  return row?.email?.toLowerCase() ?? null;
}


/**
 * Where one entry stands: its pass — numbered in the order everyone joined,
 * so it never changes — and its place in line, which is that order less any
 * places earned, among those still waiting. Null when it isn't on the list.
 */
async function standing(db: Db, email: string) {
  const rows = await db.execute<{ pass: number; position: number | null }>(sql`
    with line as (
      select ${t.waitlist.email} as email,
             ${t.waitlist.createdAt} as created_at,
             ${t.waitlist.boost} as boost,
             (row_number() over (order by ${t.waitlist.createdAt}, ${t.waitlist.email}))::int as pass,
             (${waiting}) as waiting
      from ${t.waitlist}
      left join ${t.users} on ${t.users.id} = ${t.waitlist.userId}
    ),
    me as (select * from line where email = ${email})
    select me.pass,
           case when me.waiting then (
             select (count(*) + 1)::int from line
             where line.waiting
               -- Level on the mark, the bigger boost goes first: a +10 share
               -- lands you level with the person ten ahead, and passes them too.
               and (line.pass - line.boost, -line.boost, line.created_at, line.email)
                 < (me.pass - me.boost, -me.boost, me.created_at, me.email)
           ) end as position
    from me`);
  return rows[0] ?? null;
}

/**
 * Where you stand: your handle, whether you're on the list, your pass and
 * its edition, your place in line (it moves up as people are let in and as
 * you earn places), and how your link is doing.
 */
export async function waitlistStatus(db: Db, viewer: Viewer) {
  const [entry] = await db
    .select({
      email: t.waitlist.email,
      createdAt: t.waitlist.createdAt,
      edition: t.waitlist.edition,
      boost: t.waitlist.boost,
      sharedAt: t.waitlist.sharedAt,
      linkOpens: t.waitlist.linkOpens,
    })
    .from(t.waitlist)
    .where(eq(t.waitlist.userId, viewer.userId))
    .limit(1);
  const [{ waiting: total, joined, passesLeft }, [user]] = await Promise.all([
    waitlistSize(db),
    db.select({ avatarUrl: t.users.avatarUrl }).from(t.users).where(eq(t.users.id, viewer.userId)),
  ]);
  const avatarUrl = user?.avatarUrl ?? defaultAvatar(viewer.userId);
  if (!entry)
    return {
      onList: false,
      handle: viewer.handle,
      avatarUrl,
      email: await accountEmail(db, viewer.userId),
      position: null,
      pass: null,
      founding: passesLeft > 0,
      edition: "classic" as PassEdition,
      issuedAt: null,
      boost: 0,
      shared: false,
      opens: 0,
      referrals: 0,
      waiting: total,
      joined,
      passesLeft,
      granted: viewer.accessGranted,
    };
  const [place, [referred]] = await Promise.all([
    standing(db, entry.email),
    db.select({ n: sql<number>`count(*)::int` }).from(t.waitlist).where(eq(t.waitlist.referredBy, viewer.userId)),
  ]);
  const pass = place?.pass ?? 0;
  return {
    onList: true,
    handle: viewer.handle,
    avatarUrl,
    email: entry.email,
    position: viewer.accessGranted ? null : (place?.position ?? null),
    pass,
    founding: pass <= FOUNDING_PASSES,
    edition: entry.edition as PassEdition,
    issuedAt: entry.createdAt.toISOString(),
    boost: entry.boost,
    shared: entry.sharedAt !== null,
    opens: entry.linkOpens,
    referrals: referred?.n ?? 0,
    waiting: total,
    joined,
    passesLeft,
    granted: viewer.accessGranted,
  };
}

/**
 * Make a handle yours and hold your place: the handle is checked and set
 * (the database settles two people racing for one), and the account's email
 * joins the list — keeping the earlier place if that email was already on
 * it. Claiming again, or another handle later, keeps your place.
 */
export async function claimHandle(
  deps: Pick<Deps, "clock">,
  db: Db,
  viewer: Viewer,
  handle: string,
  { edition, ref }: { edition?: PassEdition; ref?: string } = {},
) {
  if (!HANDLE_PATTERN.test(handle)) throw invalid("Use 2–24 letters, numbers or underscores.");
  const email = await accountEmail(db, viewer.userId);
  if (!email) throw invalid("Sign in with Google or an email address to hold your place.");
  // Your own handle in other letters is still yours; anything else is new.
  const changing = handle !== viewer.handle;
  if (handle.toLowerCase() !== viewer.handle.toLowerCase() && isReservedHandle(handle))
    throw invalid("That handle is reserved.");
  const now = deps.clock.now();
  try {
    await db.transaction(async (tx) => {
      if (changing) {
        const [taken] = await tx
          .select({ id: t.users.id })
          .from(t.users)
          .where(and(sql`lower(${t.users.handle}) = lower(${handle})`, ne(t.users.id, viewer.userId)))
          .limit(1);
        if (taken) throw conflict("handle_taken", "That handle is taken.");
        await tx.update(t.users).set({ handle }).where(eq(t.users.id, viewer.userId));
      }
      // Choosing a handle is the welcome step's job; it's done here.
      await tx.update(t.userSettings).set({ onboarded: true }).where(eq(t.userSettings.userId, viewer.userId));
      // New to the line? Only a newcomer can be sent by someone's link.
      const [before] = await tx
        .select({ email: t.waitlist.email })
        .from(t.waitlist)
        .where(or(eq(t.waitlist.userId, viewer.userId), eq(t.waitlist.email, email)))
        .limit(1);
      // Another address of yours may have held a place: this account's email
      // takes it over, so one account is one place in line.
      await tx.update(t.waitlist).set({ userId: null }).where(and(eq(t.waitlist.userId, viewer.userId), ne(t.waitlist.email, email)));
      await tx
        .insert(t.waitlist)
        .values({ email, userId: viewer.userId, note: "claimed a handle", createdAt: now, edition: edition ?? "classic" })
        .onConflictDoUpdate({ target: t.waitlist.email, set: { userId: viewer.userId, ...(edition && { edition }) } });
      // Claimed through a friend's link: they move up the line.
      if (!before && ref && ref.toLowerCase() !== handle.toLowerCase()) {
        const [referrer] = await tx
          .select({ id: t.users.id })
          .from(t.users)
          .innerJoin(t.waitlist, eq(t.waitlist.userId, t.users.id))
          .where(and(sql`lower(${t.users.handle}) = lower(${ref})`, ne(t.users.id, viewer.userId)))
          .limit(1);
        if (referrer) {
          await tx.update(t.waitlist).set({ referredBy: referrer.id }).where(eq(t.waitlist.email, email));
          await tx
            .update(t.waitlist)
            .set({ boost: sql`${t.waitlist.boost} + ${REFERRAL_BOOST}` })
            .where(eq(t.waitlist.userId, referrer.id));
        }
      }
    });
  } catch (error) {
    // Someone took it a moment ago: the handle index decides.
    const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
    if (cause?.code === "23505" && cause.constraint_name === "users_handle")
      throw conflict("handle_taken", "That handle is taken.");
    throw error;
  }
  return waitlistStatus(db, { ...viewer, handle });
}


/** You shared your pass: you move up the line — once. */
export async function shareWaitlist(deps: Pick<Deps, "clock">, db: Db, viewer: Viewer) {
  const [entry] = await db
    .select({ email: t.waitlist.email })
    .from(t.waitlist)
    .where(eq(t.waitlist.userId, viewer.userId))
    .limit(1);
  if (!entry) throw invalid("Claim your username first.");
  await db
    .update(t.waitlist)
    .set({ boost: sql`${t.waitlist.boost} + ${SHARE_BOOST}`, sharedAt: deps.clock.now() })
    .where(and(eq(t.waitlist.userId, viewer.userId), isNull(t.waitlist.sharedAt)));
  return waitlistStatus(db, viewer);
}

/** Someone opened a holder's link: count it, for their card. */
export async function recordLinkOpen(db: Db, handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return { counted: false };
  const rows = await db.execute<{ email: string }>(sql`
    update ${t.waitlist} set link_opens = link_opens + 1
    from ${t.users}
    where ${t.users.id} = ${t.waitlist.userId} and lower(${t.users.handle}) = lower(${handle})
    returning ${t.waitlist.email}`);
  return { counted: rows.length > 0 };
}

/** A holder's pass, as their link shows it to the world. */
export async function passCard(db: Db, handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return null;
  const [holder] = await db
    .select({ handle: t.users.handle, email: t.waitlist.email, edition: t.waitlist.edition })
    .from(t.users)
    .innerJoin(t.waitlist, eq(t.waitlist.userId, t.users.id))
    .where(sql`lower(${t.users.handle}) = lower(${handle})`)
    .limit(1);
  if (!holder) return null;
  const place = await standing(db, holder.email);
  const pass = place?.pass ?? 0;
  return { handle: holder.handle, pass, founding: pass <= FOUNDING_PASSES, edition: holder.edition as PassEdition };
}
