/** The signed-in person: profile, settings, wallets and paper account. */
import { eq } from "drizzle-orm";
import { defaultAvatar } from "@imo/core/avatars";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { notFound } from "../errors";
import type { Viewer } from "./viewer";

export async function getMe(db: Db, viewer: Viewer) {
  const [user] = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, viewer.userId));
  const [settings] = await db
    .select()
    .from(t.userSettings)
    .where(eq(t.userSettings.userId, viewer.userId));
  const [account] = await db
    .select()
    .from(t.tradingAccounts)
    .where(eq(t.tradingAccounts.id, viewer.accountId));
  if (!user || !settings || !account) throw notFound("Your account");
  const wallets = await db
    .select({
      chain: t.wallets.chain,
      address: t.wallets.address,
      custody: t.wallets.custody,
      isPrimary: t.wallets.isPrimary,
    })
    .from(t.wallets)
    .where(eq(t.wallets.userId, viewer.userId));
  return {
    user: {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      bio: user.bio,
      focus: user.focus,
      avatarUrl: user.avatarUrl ?? defaultAvatar(user.id),
      region: user.region,
      initials: user.initials,
      color: user.color,
      role: user.role,
      joinedAt: user.createdAt.toISOString(),
    },
    settings: {
      interests: settings.interests,
      onboarded: settings.onboarded,
      email: settings.email,
      emailVerified: !!settings.email && settings.emailVerifiedAt !== null,
      theme: settings.theme,
      priceInCents: settings.priceInCents,
      showPositionsOnPosts: settings.showPositionsOnPosts,
      appearOnLeaderboard: settings.appearOnLeaderboard,
      privateOpenPositions: settings.privateOpenPositions,
    },
    wallets,
    /** How this session signed in, for Settings → Account. */
    signIn: { method: viewer.method ?? null },
    account: {
      id: account.id,
      currency: account.currency,
      cashCents: cents(account.cash),
      reservedCents: cents(account.reserved),
      availableCents: cents(account.cash - account.reserved),
      startingBalanceCents: cents(account.startingBalance),
      season: account.season,
    },
  };
}
