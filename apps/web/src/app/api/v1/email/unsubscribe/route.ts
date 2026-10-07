/**
 * The unsubscribe link in every notification email. GET (a click) lands in
 * Settings; POST is the one-click unsubscribe mail clients send (RFC 8058).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@imo/server/http/route";
import { unsubscribe } from "@imo/server/usecases/digest";

const Query = z.object({ token: z.string().min(10).max(2_000) });

export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  query: Query,
  handler: async ({ deps, query }) => {
    const kind = await unsubscribe(deps, deps.db, query.token);
    const target = new URL("/settings", deps.config.APP_URL);
    target.searchParams.set("unsubscribed", kind ?? "invalid");
    return NextResponse.redirect(target, 303);
  },
});

export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  query: Query,
  handler: async ({ deps, query }) => ({ unsubscribed: (await unsubscribe(deps, deps.db, query.token)) !== null }),
});
