/** What the browser needs to know about this deployment: which sign-in
    methods exist, the public provider keys, and how to connect to realtime.
    Only values that are public by design (NEXT_PUBLIC_*) appear here. */
import { asc, eq } from "drizzle-orm";
import { VENUE_CATALOG } from "@imo/venues/catalog";
import { DESIGN_SNAPSHOT, DESIGN_SOURCE } from "../demo/design-source";
import type { ServerDeps } from "../deps";
import * as t from "../db/schema";
import { privyConfigured, supabaseConfigured, tradingMode } from "../composition/config";
import { RESET_COOLDOWN_DAYS } from "./portfolio";

/** The ways in this deployment offers, and the public address and key the
    browser signs in with (null without Supabase). */
async function signIn(deps: ServerDeps) {
  const { config } = deps;
  const supabase = supabaseConfigured(config);
  // Only ways in that are switched on at the provider (unknown: offered).
  const on = supabase ? ((await deps.identity.signInMethods?.()) ?? {}) : {};
  return {
    auth: {
      google: supabase && on.google !== false,
      // Offered only when the project says they're on: each needs its own
      // developer account (Apple's, X's) before it can work.
      apple: supabase && on.apple === true,
      x: supabase && on.x === true,
      /** Supabase's name for X sign-in in this project: "x" or "twitter". */
      xProvider: on.ids?.x ?? "x",
      wallet: supabase && on.wallet !== false,
      email: supabase && on.email !== false,
      dev: !!deps.devIdentity,
    },
    supabase: supabase
      ? {
          url: config.NEXT_PUBLIC_SUPABASE_URL!,
          publishableKey: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        }
      : null,
  };
}

export async function clientConfig(deps: ServerDeps) {
  const { config } = deps;
  const design = deps.venues.sources.has(DESIGN_SOURCE) && deps.venues.feeds.length === 0;
  const { auth, supabase } = await signIn(deps);
  return {
    profile: deps.profile,
    auth,
    supabase,
    privy: privyConfigured(config)
      ? { appId: config.NEXT_PUBLIC_PRIVY_APP_ID!, mobileClientId: config.PRIVY_MOBILE_CLIENT_ID ?? null }
      : null,
    realtime: deps.realtimeTransport,
    /** The design dataset describes one fixed moment; live data describes now. */
    dataSnapshot: design ? DESIGN_SNAPSHOT : null,
    /** Venues whose data is on screen, in catalog order: every label in the
        design dataset, or the venues fed live that we may show. */
    venues: design ? VENUE_CATALOG.map((e) => e.manifest.id) : await shownVenues(deps),
    /** Where to claim a username while the beta is closed. */
    waitlistUrl: config.WAITLIST_URL ?? null,
    /** "wallet": real money, signed by the trader's wallet; "paper": simulated. */
    trading: tradingMode(config),
    /** Wallet trading: the smallest order, and what the wallet must hold. */
    wallet:
      tradingMode(config) === "wallet"
        ? {
            minOrderCents: Math.min(...[...deps.venues.execution.values()].map((e) => e.venue.minOrder / 10_000), Infinity),
            venues: [...deps.venues.execution.keys()],
          }
        : null,
    paper: {
      startingBalanceCents: config.PAPER_STARTING_BALANCE * 100,
      resetCooldownDays: RESET_COOLDOWN_DAYS,
    },
  };
}

async function shownVenues(deps: ServerDeps) {
  const fed = new Set(deps.venues.feeds.flatMap((id) => deps.venues.served.get(id) ?? []));
  const listed = new Set(VENUE_CATALOG.map((e) => e.manifest.id));
  const rows = await deps.db
    .select({ id: t.venues.id })
    .from(t.venues)
    .where(eq(t.venues.displayAllowed, true))
    .orderBy(asc(t.venues.position));
  return rows.map((row) => row.id).filter((id) => fed.has(id) && listed.has(id));
}

/**
 * The waitlist page's config: only the ways in it can offer — Google, X, an
 * emailed link — all started on our server (/api/v1/auth/start and /email),
 * so the browser gets no provider address or key. `dev`: local and test
 * sign-in, never on in production.
 */
export async function waitlistConfig(deps: ServerDeps) {
  const { auth } = await signIn(deps);
  const ways = (["google", "x", "email"] as const).filter((way) => auth[way]);
  return { ways, ...(auth.dev ? { dev: true as const } : {}) };
}
