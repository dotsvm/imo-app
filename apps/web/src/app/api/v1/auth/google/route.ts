/**
 * Where Google sends people back when we run Google sign-in on our own
 * domain: checked against the sign-in this browser started, turned into a
 * session, then on to the page they started from (with `signin=…` when it
 * couldn't finish).
 *
 *   GET /api/v1/auth/google?code=…&state=…
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withParam } from "@imo/core/paths";
import { route } from "@imo/server/http/route";
import { finishGoogleSignIn } from "@imo/server/usecases/google-signin";

export const GET = route({
  auth: "none",
  gate: false,
  // No budget of ours, as with the callback: the code is single-use.
  query: z.object({
    code: z.string().max(2_000).optional(),
    state: z.string().max(200).optional(),
    error: z.string().max(200).optional(),
  }),
  handler: async ({ deps, request, query, credentials, requestId }) => {
    const done = await finishGoogleSignIn(deps, request.nextUrl.origin, query, credentials);
    if (done.problem)
      deps.log.warn("google sign-in didn't finish", { requestId, problem: done.problem, error: done.error ?? query.error });
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: done.problem ? withParam(done.next, "signin", done.problem) : done.next,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  },
});
