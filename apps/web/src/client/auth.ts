/**
 * Signing in from the browser. Supabase Auth when the deployment has it:
 * Google first, a Solana or Ethereum wallet, or an emailed link. Where the
 * dev identity is on (the demo, local development) a dev session stands in.
 * Either way the session lands in cookies and the API checks it on every
 * request — nothing here is trusted by the server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigDTO } from "@imo/server/dto/api-types";

export type WalletChain = "solana" | "ethereum";

/** The ways in this deployment offers. */
export interface SignInMethods {
  google: boolean;
  apple: boolean;
  x: boolean;
  wallet: boolean;
  email: boolean;
  /** Dev sessions: the demo trader, or any address signed in on the spot. */
  dev: boolean;
}

export const signInMethods = (cfg: ConfigDTO | null): SignInMethods => ({
  google: !!cfg?.auth.google,
  apple: !!cfg?.auth.apple,
  x: !!cfg?.auth.x,
  wallet: !!cfg?.auth.wallet,
  email: !!cfg?.auth.email,
  dev: !!cfg?.auth.dev,
});

let client: Promise<SupabaseClient> | undefined;

/** One Supabase client per tab, loaded only once something needs it. Its
    session lives in the same cookies the API reads. */
export function supabaseClient(cfg: Pick<ConfigDTO, "supabase">): Promise<SupabaseClient> {
  if (!cfg.supabase) throw new Error("Supabase isn't configured here.");
  const { url, publishableKey } = cfg.supabase;
  client ??= import("@supabase/ssr").then(({ createBrowserClient }) =>
    createBrowserClient(url, publishableKey),
  );
  return client;
}

/** Where Google and emailed links come back to, then on to `next`. */
export const callbackUrl = (next: string) =>
  `${window.location.origin}/api/v1/auth/callback?next=${encodeURIComponent(next)}`;

type Injected = {
  phantom?: { solana?: unknown };
  solana?: unknown;
  ethereum?: unknown;
};

/** The wallet a browser extension (or a wallet's own browser) injected. */
export function injectedWallet(chain: WalletChain): unknown {
  const w = window as unknown as Injected;
  return chain === "solana" ? (w.phantom?.solana ?? w.solana) : w.ethereum;
}

/** Phones have no extensions: open this page inside the wallet's browser. */
export function walletBrowserLink(chain: WalletChain) {
  const here = window.location.href;
  return chain === "solana"
    ? `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(window.location.origin)}`
    : `https://metamask.app.link/dapp/${here.replace(/^https?:\/\//, "")}`;
}

/** A dev session's subject for an address: stable, so it's the same account
    next time. */
export const devSubject = (email: string) =>
  email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .padEnd(2, "0");

const SIGNED_OUT = "hunch.signedOut";

/** Signing out of the demo sticks: it doesn't sign you back in on reload. */
export const signedOutHere = () => {
  try {
    return window.localStorage.getItem(SIGNED_OUT) === "1";
  } catch {
    return false;
  }
};
export const rememberSignedOut = (value: boolean) => {
  try {
    if (value) window.localStorage.setItem(SIGNED_OUT, "1");
    else window.localStorage.removeItem(SIGNED_OUT);
  } catch {
    // Private windows may refuse storage; the demo then signs back in.
  }
};
