/**
 * Supabase Auth as the identity provider: Google sign-in first, plus Sign in
 * with Solana or Ethereum. Sessions live in cookies (web) or arrive as a
 * Bearer access token (mobile, scripts). Tokens are verified against the
 * project's signing keys with getClaims(), never trusted as-is.
 */
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType, Provider } from "@supabase/supabase-js";
import type {
  ExternalIdentity,
  IdentityProvider,
  RequestCredentials,
  SignInMethods,
  SignInReturn,
  WalletChain,
} from "@imo/core/ports/identity";

interface SupabaseClaims {
  sub: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: { provider?: string };
}

/** Web3 sign-in stores the proven address in the user's metadata. */
function walletFrom(claims: SupabaseClaims): ExternalIdentity["wallet"] {
  const meta = claims.user_metadata ?? {};
  const custom = (meta.custom_claims ?? {}) as Record<string, unknown>;
  const chain = (custom.chain ?? meta.chain) as string | undefined;
  const address = (custom.address ?? meta.address ?? meta.wallet_address) as
    string | undefined;
  const provider = claims.app_metadata?.provider ?? "";
  const resolved: WalletChain | undefined =
    chain === "solana" ||
    (provider === "web3" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address ?? ""))
      ? "solana"
      : chain === "ethereum" || /^0x[0-9a-fA-F]{40}$/.test(address ?? "")
        ? "ethereum"
        : undefined;
  return resolved && address ? { chain: resolved, address } : undefined;
}

/** A malformed escape in someone else's cookie mustn't fail the request. */
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const requestCookies = (credentials: RequestCredentials) =>
  (credentials.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: decode(pair.slice(i + 1)) };
    });

/** Supabase's session cookies, chunked as .0, .1…, and the PKCE verifier. */
const SESSION_COOKIE = /^sb-[a-z0-9-]+-auth-token(-code-verifier)?(\.\d+)?$/;

export class SupabaseIdentity implements IdentityProvider {
  readonly id = "supabase";
  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
    /** Tests stand in for Supabase's API here. */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  /** A client over this request's cookies; refreshed sessions write back. */
  private client(credentials: RequestCredentials) {
    return createServerClient(this.url, this.publishableKey, {
      ...(this.fetchImpl && { global: { fetch: this.fetchImpl } }),
      cookies: {
        getAll: () => requestCookies(credentials),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies)
            credentials.setCookie?.(
              name,
              value,
              options as Record<string, unknown>,
            );
        },
      },
    });
  }

  async resolve(
    credentials: RequestCredentials,
  ): Promise<ExternalIdentity | null> {
    const client = this.client(credentials);
    const bearer = credentials.headers
      .get("authorization")
      ?.match(/^Bearer (?!dev\.)(.+)$/)?.[1];
    const { data, error } = await client.auth.getClaims(bearer);
    if (error || !data?.claims?.sub) return null;
    const claims = data.claims as unknown as SupabaseClaims;
    const meta = claims.user_metadata ?? {};
    const provider = claims.app_metadata?.provider;
    return {
      provider: this.id,
      subject: claims.sub,
      email: claims.email || undefined,
      emailVerified: meta.email_verified === true,
      name: (meta.full_name ?? meta.name) as string | undefined,
      avatarUrl: (meta.avatar_url ?? meta.picture) as string | undefined,
      method:
        provider === "web3"
          ? `web3:${walletFrom(claims)?.chain ?? "unknown"}`
          : provider,
      wallet: walletFrom(claims),
    };
  }

  /** Google, Apple or X, started on the server: the verifier goes out as a
      cookie and Supabase's authorize page comes back. X is "x" (OAuth 2.0)
      or the older "twitter" provider, whichever the project has on. */
  async startSignIn(
    method: "google" | "apple" | "x",
    returnTo: string,
    credentials: RequestCredentials,
  ): Promise<string> {
    const provider = method === "x" ? ((await this.signInMethods()).ids?.x ?? "x") : method;
    const { data, error } = await this.client(credentials).auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: returnTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Supabase gave no sign-in page.");
    return data.url;
  }

  /** An emailed sign-in link (PKCE: the verifier is a cookie here). */
  async sendSignInLink(
    email: string,
    returnTo: string,
    credentials: RequestCredentials,
  ): Promise<void> {
    const { error } = await this.client(credentials).auth.signInWithOtp({
      email,
      options: { emailRedirectTo: returnTo, shouldCreateUser: true },
    });
    if (error) throw error;
  }

  /** Google's ID token, from Google sign-in run on our own domain: Supabase
      checks its signature, audience and nonce, then the session goes out
      as cookies like any other. */
  async signInWithIdToken(
    provider: "google",
    idToken: string,
    nonce: string,
    credentials: RequestCredentials,
  ): Promise<void> {
    const { error } = await this.client(credentials).auth.signInWithIdToken({ provider, token: idToken, nonce });
    if (error) throw error;
  }

  /** Google and emailed links come back with a code (PKCE: the verifier is
      the cookie set when sign-in started) or a token hash. */
  async completeSignIn(
    returned: SignInReturn,
    credentials: RequestCredentials,
  ): Promise<boolean> {
    const { auth } = this.client(credentials);
    if (returned.code) {
      const { error } = await auth.exchangeCodeForSession(returned.code);
      if (error) throw error;
      return true;
    }
    if (returned.tokenHash && returned.type) {
      const { error } = await auth.verifyOtp({
        token_hash: returned.tokenHash,
        type: returned.type as EmailOtpType,
      });
      if (error) throw error;
      return true;
    }
    return false;
  }

  private methods?: { at: number; value: Promise<SignInMethods> };

  /**
   * What the project has switched on (Auth → Providers), from its public
   * settings, for a minute at a time — so a button never leads to Supabase's
   * "provider is not enabled" page. Unreachable: nothing is ruled out.
   */
  signInMethods(): Promise<SignInMethods> {
    const now = Date.now();
    if (this.methods && now - this.methods.at < 60_000) return this.methods.value;
    const value = (async () => {
      try {
        const res = await (this.fetchImpl ?? fetch)(`${this.url.replace(/\/+$/, "")}/auth/v1/settings`, {
          headers: { apikey: this.publishableKey },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return {};
        const { external = {} } = (await res.json()) as { external?: Record<string, boolean | undefined> };
        const wallet = external.web3_solana ?? external.web3_ethereum ?? external.web3;
        return {
          google: external.google === true,
          apple: external.apple === true,
          // X: the OAuth 2.0 provider, or Twitter's older OAuth 1.0a one.
          x: external.x === true || external.twitter === true,
          email: external.email === true,
          ...(wallet !== undefined && { wallet: wallet === true }),
          ids: { x: external.x === true ? "x" : "twitter" },
        };
      } catch {
        return {};
      }
    })();
    this.methods = { at: now, value };
    return value;
  }

  /** This device only: its refresh token is revoked and the cookies cleared. */
  async signOut(credentials: RequestCredentials) {
    const { error } = await this.client(credentials).auth.signOut({ scope: "local" });
    // Supabase unreachable: the browser forgets the session all the same.
    if (error)
      for (const { name } of requestCookies(credentials))
        if (SESSION_COOKIE.test(name))
          credentials.setCookie?.(name, "", { path: "/", maxAge: 0 });
  }
}
