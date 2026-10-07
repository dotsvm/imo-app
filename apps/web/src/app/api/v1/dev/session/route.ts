/**
 * Dev sign-in, for local development and tests only: the dev identity is
 * never wired in production or staging, so this answers 404 there.
 */
import { z } from "zod";
import { DEV_SESSION_COOKIE } from "@imo/server/deps";
import { notFound } from "@imo/server/errors";
import { route } from "@imo/server/http/route";

const Body = z.object({
  /** Who to sign in as: a stable subject ("you", "e2e-1"…). */
  subject: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60).optional(),
  email: z.email().optional(),
});

/** Secure wherever the site is served over HTTPS. */
const cookie = (appUrl: string) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: appUrl.startsWith("https://"),
});

export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  body: Body,
  handler: async ({ deps, body, setCookie }) => {
    if (!deps.devIdentity) throw notFound("Dev sign-in");
    const token = deps.devIdentity.issue(body.subject, {
      name: body.name,
      email: body.email,
    });
    setCookie(DEV_SESSION_COOKIE, token, {
      ...cookie(deps.config.APP_URL),
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true, token: `dev.${token}` };
  },
});

export const DELETE = route({
  auth: "none",
  gate: false,
  handler: async ({ deps, setCookie }) => {
    if (!deps.devIdentity) throw notFound("Dev sign-in");
    setCookie(DEV_SESSION_COOKIE, "", { ...cookie(deps.config.APP_URL), maxAge: 0 });
    return { ok: true };
  },
});
