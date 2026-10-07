/**
 * Identity and wallet ports. Who a request belongs to, and which wallets they
 * hold, without naming an auth or wallet provider. Users are always ours; a
 * provider's subject maps onto a user through auth_identities.
 */

/** The part of a request an identity provider may read. */
export interface RequestCredentials {
  headers: Headers;
  cookie(name: string): string | undefined;
  /** Cookies a provider writes back, e.g. a refreshed session. */
  setCookie?(
    name: string,
    value: string,
    options: Record<string, unknown>,
  ): void;
}

export type WalletChain = "solana" | "ethereum";

export interface ExternalIdentity {
  /** "supabase", "dev", … */
  provider: string;
  /** The provider's stable id for the person. */
  subject: string;
  email?: string;
  /** The provider checked the address (Google does); mail may go to it. */
  emailVerified?: boolean;
  name?: string;
  avatarUrl?: string;
  /** How they signed in: "google", "web3:solana", "dev", … */
  method?: string;
  /** A wallet proven by signature at sign-in (sign in with Solana or Ethereum). */
  wallet?: { chain: WalletChain; address: string };
}

/**
 * What comes back when a sign-in leaves the site and returns: an OAuth or
 * PKCE `code` (Google), or an emailed link's `tokenHash` and its `type`.
 */
export interface SignInReturn {
  code?: string;
  tokenHash?: string;
  type?: string;
}

export interface IdentityProvider {
  readonly id: string;
  /** The signed-in person, or null. Never trusts unverified input. */
  resolve(credentials: RequestCredentials): Promise<ExternalIdentity | null>;
  /**
   * Finish a sign-in that came back to us: trade what the provider sent for a
   * session, written as cookies. False when it isn't this provider's; throws
   * when it is but can't finish (an expired or reused link).
   */
  completeSignIn?(
    returned: SignInReturn,
    credentials: RequestCredentials,
  ): Promise<boolean>;
  /**
   * Start signing in with a social provider from the server, so the browser
   * never needs the provider's address or key: the PKCE verifier is written
   * as a cookie, and the provider's sign-in page comes back to redirect to.
   * It returns to `returnTo` (our callback).
   */
  startSignIn?(
    method: Exclude<SignInMethod, "email" | "wallet">,
    returnTo: string,
    credentials: RequestCredentials,
  ): Promise<string>;
  /** Email a sign-in link that returns to `returnTo`; like startSignIn, its
      verifier is a cookie on this browser, so the link opens here. */
  sendSignInLink?(
    email: string,
    returnTo: string,
    credentials: RequestCredentials,
  ): Promise<void>;
  /** A session from an ID token a provider issued us directly (Google, on
      our own domain): the provider checks the token, then writes the
      session as cookies. `nonce`: the raw value whose hash we sent. */
  signInWithIdToken?(
    provider: "google",
    idToken: string,
    nonce: string,
    credentials: RequestCredentials,
  ): Promise<void>;
  /** End the session this request carries and clear its cookies. */
  signOut?(credentials: RequestCredentials): Promise<void>;
  /** Which ways in are switched on at the provider right now ("google",
      "email", "wallet"…); a way it can't vouch for is left out. `ids`: the
      provider's own name for a way in, where it has more than one. */
  signInMethods?(): Promise<SignInMethods>;
}

export type SignInMethod = "google" | "apple" | "x" | "email" | "wallet";
export type SignInMethods = Partial<Record<SignInMethod, boolean>> & {
  ids?: Partial<Record<SignInMethod, string>>;
};

export interface ProvidedWallet {
  chain: WalletChain;
  address: string;
  custody: "embedded" | "external";
}

/**
 * Embedded wallets: created for a person by the wallet provider when they
 * first sign in (the pump.fun pattern), self-custodial, and verifiable server
 * side so a client can never claim someone else's address.
 */
export interface WalletProvider {
  readonly id: string;
  /** The wallets the provider holds for this person, by our identity subject. */
  walletsFor(identity: ExternalIdentity): Promise<ProvidedWallet[]>;
}

/**
 * Google sign-in run by us, so Google's screen names our domain rather than
 * the identity provider's: the authorize address (OAuth 2.0 with PKCE and a
 * nonce), and the code Google returns traded for its signed ID token.
 */
export interface GoogleSignIn {
  authorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string; nonce: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<{ idToken: string }>;
}
