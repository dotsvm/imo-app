import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@imo/server/errors";
import { route } from "@imo/server/http/route";
import { verifyEmail } from "@imo/server/usecases/people";

/** The link in the confirmation email: confirm, then land in Settings. */
export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  query: z.object({ token: z.string().min(10).max(2_000) }),
  handler: async ({ deps, query }) => {
    const target = new URL("/settings", deps.config.APP_URL);
    try {
      await verifyEmail(deps, deps.db, query.token);
      target.searchParams.set("email", "verified");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      target.searchParams.set("email", "invalid");
    }
    return NextResponse.redirect(target, 303);
  },
});
