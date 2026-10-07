import { z } from "zod";
import { admin, InviteBatch } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { issueInvites, listInvites } from "@imo/server/usecases/admin";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ active: z.enum(["true", "false"]).transform((v) => v === "true").optional() }),
  handler: ({ deps, query }) => listInvites(deps.db, deps.clock.now(), query.active ?? false),
});

export const POST = route({
  ...admin,
  limit: "api:write",
  status: 201,
  body: InviteBatch,
  handler: ({ deps, viewer, body }) => issueInvites(deps, deps.db, viewer, body),
});
