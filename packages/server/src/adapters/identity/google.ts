/**
 * Google's OAuth 2.0 endpoints, for signing in on our own domain: Google's
 * screen names the address it returns to, so that address is ours. The ID
 * token it issues is handed to the identity provider (Supabase), which
 * checks it and starts the session.
 */
import type { GoogleSignIn } from "@imo/core/ports/identity";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export class GoogleOAuth implements GoogleSignIn {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    /** Tests stand in for Google's token endpoint here. */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  authorizeUrl({ redirectUri, state, codeChallenge, nonce }: Parameters<GoogleSignIn["authorizeUrl"]>[0]) {
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce,
    }).toString();
    return url.toString();
  }

  async exchangeCode({ code, redirectUri, codeVerifier }: Parameters<GoogleSignIn["exchangeCode"]>[0]) {
    const res = await (this.fetchImpl ?? fetch)(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.id_token)
      throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
    return { idToken: body.id_token };
  }
}
