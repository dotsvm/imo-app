/**
 * Who is asking. The first time an identity signs in, everything they need is
 * provisioned in one transaction: their profile, settings, notification
 * preferences, a $10,000 paper account (with its opening ledger entry) and the
 * default Saved list. Wallets follow right after — a proven sign-in wallet,
 * and embedded wallets from the wallet provider.
 */
import { and, eq, sql } from "drizzle-orm";
import type { ExternalIdentity } from "@imo/core/ports/identity";
import { BETA_GATE, type Deps } from "../composition";
import { tradingMode, type Config } from "../composition/config";
import { AVATAR_COLORS, NOTIFICATION_PREFERENCES, PAPER_ROUTE, WALLET_ROUTE, isReservedHandle } from "../catalogs";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { appendEvent } from "../outbox";

export interface Viewer {
  userId: string;
  handle: string;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  /** The trading account on the active route: the wallet mirror when trading
      with real money, the paper account otherwise. */
  accountId: string;
  /** Let into the private beta. */
  accessGranted: boolean;
  /** How this request signed in: "google", "email", "web3:solana", "dev"… */
  method?: string;
}

type ViewerDeps = Pick<
  Deps,
  "clock" | "config" | "log" | "wallets" | "jobs" | "flags"
> & { db: Db };

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
    .padEnd(2, "·")
    .slice(0, 2);

const handleBase = (identity: ExternalIdentity) => {
  const source =
    identity.email?.split("@")[0] ??
    identity.name ??
    (identity.wallet
      ? `trader_${identity.wallet.address.slice(-4)}`
      : "trader");
  const cleaned = source.replace(/[^A-Za-z0-9_]/g, "").slice(0, 18);
  return cleaned.length >= 2 && !isReservedHandle(cleaned) ? cleaned : `trader${cleaned}`.slice(0, 18);
};

async function freeHandle(db: Db, base: string) {
  for (let i = 0; i < 20; i++) {
    const candidate =
      i === 0 ? base : `${base}${Math.floor(100 + Math.random() * 900)}`;
    const [taken] = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(sql`lower(${t.users.handle}) = lower(${candidate})`)
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base.slice(0, 12)}${Date.now().toString(36).slice(-6)}`;
}

/** The route trades go through: real money from the wallet, or paper. */
export const activeRoute = (config: Config) => (tradingMode(config) === "wallet" ? WALLET_ROUTE : PAPER_ROUTE);

async function load(
  db: Db,
  provider: string,
  subject: string,
  route: string,
): Promise<Viewer | null> {
  const [row] = await db
    .select({
      userId: t.users.id,
      handle: t.users.handle,
      displayName: t.users.displayName,
      role: t.users.role,
      status: t.users.status,
      deletedAt: t.users.deletedAt,
      accessGrantedAt: t.users.accessGrantedAt,
      accountId: t.tradingAccounts.id,
    })
    .from(t.authIdentities)
    .innerJoin(t.users, eq(t.users.id, t.authIdentities.userId))
    .leftJoin(
      t.tradingAccounts,
      and(
        eq(t.tradingAccounts.userId, t.users.id),
        eq(t.tradingAccounts.routeId, route),
      ),
    )
    .where(
      and(
        eq(t.authIdentities.provider, provider),
        eq(t.authIdentities.subject, subject),
      ),
    )
    .limit(1);
  if (!row || row.deletedAt) return null;
  const { deletedAt: _deleted, accessGrantedAt, accountId, ...viewer } = row;
  void _deleted;
  return {
    ...viewer,
    // Someone who joined before this route was active gets its account now.
    accountId: accountId ?? (await openAccount(db, row.userId, route)),
    accessGranted: accessGrantedAt !== null,
  };
}

/** A wallet account holds no cash of ours: the money stays in the wallet. */
async function openAccount(db: Db, userId: string, route: string) {
  await db
    .insert(t.tradingAccounts)
    .values({ userId, routeId: route, currency: "USD", cash: 0, startingBalance: 0 })
    .onConflictDoNothing();
  const [account] = await db
    .select({ id: t.tradingAccounts.id })
    .from(t.tradingAccounts)
    .where(and(eq(t.tradingAccounts.userId, userId), eq(t.tradingAccounts.routeId, route)));
  return account!.id;
}

async function provision(deps: ViewerDeps, identity: ExternalIdentity) {
  const { db, clock, config } = deps;
  const name =
    identity.name?.trim() || identity.email?.split("@")[0] || "New trader";
  const handle = await freeHandle(db, handleBase(identity));
  const route = activeRoute(config);
  // Paper starts with play money; a wallet account starts empty (the money is onchain).
  const starting = route === PAPER_ROUTE ? config.PAPER_STARTING_BALANCE * 1_000_000 : 0; // whole dollars → micro-dollars
  const now = clock.now();
  // While the beta is open, everyone who signs up is in.
  const open = !(await deps.flags.enabled(BETA_GATE));
  const admin =
    !!identity.email &&
    !!identity.emailVerified &&
    config.ADMIN_EMAILS.includes(identity.email.toLowerCase());
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(t.users)
      .values({
        handle,
        displayName: name,
        initials: initialsOf(name),
        color: AVATAR_COLORS[handle.length % AVATAR_COLORS.length],
        accessGrantedAt: open || admin ? now : null,
        role: admin ? "admin" : "user",
        createdAt: now,
      })
      .returning({ id: t.users.id });
    const claimed = await tx
      .insert(t.authIdentities)
      .values({
        provider: identity.provider,
        subject: identity.subject,
        userId: user.id,
        email: identity.email,
      })
      .onConflictDoNothing()
      .returning({ userId: t.authIdentities.userId });
    // Someone else provisioned this identity a moment ago: undo ours.
    if (!claimed.length) throw new ProvisionRace();
    await tx.insert(t.userSettings).values({
      userId: user.id,
      email: identity.email,
      emailVerifiedAt: identity.email && identity.emailVerified ? clock.now() : null,
    });
    await tx.insert(t.notificationPrefs).values(
      NOTIFICATION_PREFERENCES.map((p) => ({
        userId: user.id,
        kind: p.id,
        app: p.app,
        email: p.email,
      })),
    );
    const [account] = await tx
      .insert(t.tradingAccounts)
      .values({
        userId: user.id,
        routeId: route,
        currency: "USD",
        cash: starting,
        startingBalance: starting,
        createdAt: now,
      })
      .returning({ id: t.tradingAccounts.id });
    if (starting)
      await tx.insert(t.ledgerEntries).values({
        accountId: account.id,
        amount: starting,
        currency: "USD",
        kind: "deposit",
        memo: "Opening paper balance",
        createdAt: now,
      });
    await tx
      .insert(t.watchlists)
      .values({ ownerId: user.id, name: "Saved markets", isDefault: true });
    await appendEvent(tx, "user.created", `user:${user.id}`, {
      userId: user.id,
      method: identity.method ?? identity.provider,
      at: clock.now().toISOString(),
    });
  });
}

class ProvisionRace extends Error {}

/** Postgres unique_violation, through drizzle's wrapper. */
const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string }; code?: string })?.cause?.code ===
    "23505" || (error as { code?: string })?.code === "23505";

/** Record wallets: the one proven at sign-in, then embedded ones. */
export async function attachWallets(
  deps: ViewerDeps,
  viewer: Viewer,
  identity: ExternalIdentity,
) {
  const { db, clock } = deps;
  const found = [
    ...(identity.wallet
      ? [
          {
            ...identity.wallet,
            custody: "external" as const,
            provider: identity.provider,
          },
        ]
      : []),
    ...(deps.wallets
      ? (await deps.wallets.walletsFor(identity)).map((w) => ({
          ...w,
          provider: deps.wallets!.id,
        }))
      : []),
  ];
  for (const wallet of found)
    await db
      .insert(t.wallets)
      .values({
        userId: viewer.userId,
        chain: wallet.chain,
        address: wallet.address,
        custody: wallet.custody,
        provider: wallet.provider,
        verifiedAt: clock.now(),
        isPrimary: wallet.custody === "embedded" && wallet.chain === "solana",
      })
      .onConflictDoNothing();
  return found.length;
}

/**
 * The viewer for a verified identity, provisioning them on first sign-in.
 * Concurrent first requests converge on one user.
 */
export async function viewerFor(
  deps: ViewerDeps,
  identity: ExternalIdentity,
): Promise<Viewer> {
  const method = identity.method ?? identity.provider;
  const existing = await load(deps.db, identity.provider, identity.subject, activeRoute(deps.config));
  if (existing) return { ...existing, method };
  // Concurrent first requests race: one wins the identity, the rest find it.
  // Two different people can also pick the same free handle at once; the
  // loser retries with another.
  let viewer: Viewer | null = null;
  for (let attempt = 0; attempt < 4 && !viewer; attempt++) {
    try {
      await provision(deps, identity);
    } catch (error) {
      if (!(error instanceof ProvisionRace) && !isUniqueViolation(error))
        throw error;
    }
    viewer = await load(deps.db, identity.provider, identity.subject, activeRoute(deps.config));
  }
  if (!viewer) throw new Error("Provisioning finished without a viewer");
  viewer = { ...viewer, method };
  try {
    await attachWallets(deps, viewer, identity);
  } catch (error) {
    // Wallets can follow later; signing in must not fail because a wallet
    // provider is briefly unavailable.
    deps.log.warn("wallet provisioning deferred", {
      userId: viewer.userId,
      error: (error as Error).message,
    });
    await deps.jobs.enqueue(
      "wallets.provision",
      { identity, userId: viewer.userId },
      { key: `wallets:${viewer.userId}` },
    );
  }
  return viewer;
}

/** The deferred half of a sign-in whose wallet provider was unavailable. A
    throw retries the job with backoff. */
export async function provisionWallets(
  deps: ViewerDeps,
  payload: { identity: ExternalIdentity; userId: string },
) {
  const viewer = await load(deps.db, payload.identity.provider, payload.identity.subject, activeRoute(deps.config));
  if (!viewer || viewer.userId !== payload.userId) return;
  await attachWallets(deps, viewer, payload.identity);
}

/**
 * Someone with no embedded wallet while a wallet provider is configured —
 * provisioning failed and its retries ran out (the provider was down, or
 * refused): ask again. Deduplicated while a request is pending, so calling
 * it on every visit is cheap.
 */
export async function ensureWallets(
  deps: Pick<Deps, "wallets" | "jobs" | "clock">,
  db: Db,
  viewer: Viewer,
) {
  if (!deps.wallets) return;
  const [embedded] = await db
    .select({ id: t.wallets.id })
    .from(t.wallets)
    .where(and(eq(t.wallets.userId, viewer.userId), eq(t.wallets.custody, "embedded")))
    .limit(1);
  if (embedded) return;
  const [identity] = await db
    .select({ provider: t.authIdentities.provider, subject: t.authIdentities.subject, email: t.authIdentities.email })
    .from(t.authIdentities)
    .where(eq(t.authIdentities.userId, viewer.userId))
    .limit(1);
  if (!identity) return;
  await deps.jobs.enqueue(
    "wallets.provision",
    { identity: { provider: identity.provider, subject: identity.subject, email: identity.email ?? undefined }, userId: viewer.userId },
    // Not at once: a first sign-in's own request may still be making them.
    { key: `wallets:${viewer.userId}`, runAt: new Date(deps.clock.now().getTime() + 30_000) },
  );
}
