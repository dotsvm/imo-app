import { z } from "zod";
import { route } from "@imo/server/http/route";
import { IdParams } from "@imo/server/http/post-schemas";
import { buildTip, tipsOn } from "@imo/server/usecases/skr";

/** How much SKR this prediction has been tipped. */
export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: IdParams,
  handler: ({ deps, viewer, params }) => tipsOn(deps.db, viewer, params.id),
});

/** An SKR tip to the author, built for the tipper's wallet to sign. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  params: IdParams,
  body: z.object({ skr: z.number().positive().max(10_000_000) }),
  handler: ({ deps, viewer, params, body }) => buildTip(deps, deps.db, viewer, params.id, body),
});
