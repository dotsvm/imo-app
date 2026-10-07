import { z } from "zod";
import { route } from "@imo/server/http/route";
import { getPosition } from "@imo/server/usecases/portfolio";

export const GET = route({
  auth: "required",
  limit: "api:read",
  params: z.object({ id: z.string().regex(/^[a-z0-9-]+:(yes|no)$/) }),
  handler: ({ deps, viewer, params }) => getPosition(deps.db, viewer, params.id),
});
