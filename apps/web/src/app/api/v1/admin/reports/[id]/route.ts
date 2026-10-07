import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { resolveReport } from "@imo/server/usecases/reports";

/** Dismiss, remove the content, or remove it and suspend its author. */
export const POST = route({
  ...admin,
  limit: "api:write",
  params: z.object({ id: z.uuid() }),
  body: z.object({ action: z.enum(["dismiss", "remove", "suspend"]) }),
  handler: ({ deps, viewer, params, body }) => resolveReport(deps, deps.db, viewer, params.id, body.action),
});
