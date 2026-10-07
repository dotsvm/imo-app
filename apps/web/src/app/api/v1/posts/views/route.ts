import { z } from "zod";
import { route } from "@imo/server/http/route";
import { recordViews } from "@imo/server/usecases/posts";

/** Predictions that scrolled into view, counted once per person per six hours. */
export const POST = route({
  auth: "optional",
  // Reading counts, whoever reads.
  gate: false,
  limit: "api:read",
  body: z.object({ ids: z.array(z.uuid()).min(1).max(50) }),
  handler: ({ deps, viewer, body, request }) =>
    recordViews(
      deps,
      deps.db,
      viewer?.userId ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous",
      body.ids,
    ),
});
