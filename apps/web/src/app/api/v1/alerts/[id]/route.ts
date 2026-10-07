import { z } from "zod";
import { route } from "@imo/server/http/route";
import { deleteAlert } from "@imo/server/usecases/alerts";

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: z.object({ id: z.uuid() }),
  handler: ({ deps, viewer, params }) => deleteAlert(deps.db, viewer, params.id),
});
