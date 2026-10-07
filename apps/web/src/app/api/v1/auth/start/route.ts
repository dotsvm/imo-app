/**
 * Start signing in with Google or X from our own server: the browser is sent
 * to the provider's page and never needs Supabase's address or key. It comes
 * back through /api/v1/auth/callback, then on to `next`; if it can't start,
 * straight back to `next` with `signin=failed`.
 *
 *   GET /api/v1/auth/start?with=google&next=/
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { safeNext, signInReturn, withParam } from "@imo/core/paths";
import { route } from "@imo/server/http/route";
import { startGoogleSignIn } from "@imo/server/usecases/google-signin";

export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  query: z.object({
    with: z.enum(["google", "x"]),
    next: z.string().max(2_000).optional(),
  }),
  handler: async ({ deps, request, query, credentials, requestId }) => {
    const next = safeNext(query.next);
    const go = (location: string) =>
      new NextResponse(null, {
        status: 303,
        headers: { location, "cache-control": "no-store", "x-request-id": requestId },
      });
    const failed = () => go(withParam(next, "signin", "failed"));
    // A way in the project has switched off leads nowhere: say so here.
    const on = (await deps.identity.signInMethods?.()) ?? {};
    if (on[query.with] === false) return failed();
    // Google, run by us when its OAuth client is configured: Google's screen
    // then names our domain. Otherwise through the identity provider's page.
    if (query.with === "google") {
      const google = startGoogleSignIn(deps, request.nextUrl.origin, next, credentials);
      if (google) return go(google);
    }
    if (!deps.identity.startSignIn) return failed();
    try {
      // Back to the host this browser is on: that's where its verifier cookie is.
      return go(await deps.identity.startSignIn(query.with, signInReturn(request.nextUrl.origin, next), credentials));
    } catch (error) {
      deps.log.warn("sign-in couldn't start", {
        requestId,
        with: query.with,
        error: error instanceof Error ? error.message : String(error),
      });
      return failed();
    }
  },
});
