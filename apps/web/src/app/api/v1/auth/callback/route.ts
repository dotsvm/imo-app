/**
 * Where Google and emailed sign-in links come back. The identity provider
 * trades the code (or the link's token hash) for a session cookie, then it's
 * on to the page they started from — one of ours, never another site. If it
 * can't finish, they land there with `signin=cancelled|expired|failed`.
 *
 *   GET /api/v1/auth/callback?code=…&next=/feed
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { safeNext, withParam } from "@imo/core/paths";
import { route } from "@imo/server/http/route";

export const GET = route({
  auth: "none",
  gate: false,
  // No budget of ours: a browser mid-redirect can't do anything with a 429
  // (people behind one office or carrier address sign in together), and the
  // code is single-use, exchanged under Supabase's own limits.
  query: z.object({
    code: z.string().max(1_000).optional(),
    token_hash: z.string().max(1_000).optional(),
    type: z.string().max(40).optional(),
    next: z.string().max(2_000).optional(),
    error: z.string().max(200).optional(),
    error_description: z.string().max(1_000).optional(),
  }),
  handler: async ({ deps, query, credentials, requestId }) => {
    const next = safeNext(query.next);
    // Relative, so they come back to the host the cookies were set for.
    const back = (problem?: "cancelled" | "expired" | "failed") =>
      new NextResponse(null, {
        status: 303,
        headers: {
          location: problem ? withParam(next, "signin", problem) : next,
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      });
    if (query.error) {
      deps.log.info("sign-in came back with an error", {
        requestId,
        error: query.error,
        description: query.error_description,
      });
      return back(query.error === "access_denied" ? "cancelled" : "failed");
    }
    try {
      const done = await deps.identity.completeSignIn?.(
        { code: query.code, tokenHash: query.token_hash, type: query.type },
        credentials,
      );
      return back(done ? undefined : "failed");
    } catch (error) {
      deps.log.warn("sign-in couldn't finish", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return back("expired");
    }
  },
});
