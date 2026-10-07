/**
 * The dev identity: signed sessions for local development and tests, never
 * wired in production or staging (the composition root refuses). A session
 * is an HMAC-signed token naming a subject, in a cookie or a Bearer header.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ExternalIdentity,
  IdentityProvider,
  RequestCredentials,
} from "@imo/core/ports/identity";
import type { Clock } from "@imo/core/ports/runtime";

export const DEV_SESSION_COOKIE = "hunch_dev_session";

interface Claims {
  sub: string;
  name?: string;
  email?: string;
  exp: number;
}

const b64 = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

export class DevIdentity implements IdentityProvider {
  readonly id = "dev";
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {
    if (secret.length < 32)
      throw new Error("SESSION_SECRET must be at least 32 characters");
  }

  private sign(payload: string) {
    return b64(createHmac("sha256", this.secret).update(payload).digest());
  }

  /** A session token for `subject`, valid for `ttlSeconds`. */
  issue(
    subject: string,
    extra: { name?: string; email?: string } = {},
    ttlSeconds = 60 * 60 * 24 * 30,
  ) {
    const claims: Claims = {
      sub: subject,
      ...extra,
      exp: Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds,
    };
    const payload = b64(JSON.stringify(claims));
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string): Claims | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    try {
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString(),
      ) as Claims;
      if (typeof claims.sub !== "string" || !claims.sub) return null;
      if (claims.exp * 1000 <= this.clock.now().getTime()) return null;
      return claims;
    } catch {
      return null;
    }
  }

  async resolve(
    credentials: RequestCredentials,
  ): Promise<ExternalIdentity | null> {
    const bearer = credentials.headers
      .get("authorization")
      ?.match(/^Bearer dev\.(.+)$/)?.[1];
    const token = bearer ?? credentials.cookie(DEV_SESSION_COOKIE);
    const claims = token ? this.verify(token) : null;
    if (!claims) return null;
    return {
      provider: this.id,
      subject: claims.sub,
      name: claims.name,
      email: claims.email,
      emailVerified: !!claims.email,
      method: "dev",
    };
  }

  async signOut(credentials: RequestCredentials) {
    if (credentials.cookie(DEV_SESSION_COOKIE) !== undefined)
      credentials.setCookie?.(DEV_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
}
