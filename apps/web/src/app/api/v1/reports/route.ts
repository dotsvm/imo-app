import { z } from "zod";
import { route } from "@imo/server/http/route";
import { fileReport, REPORT_REASONS } from "@imo/server/usecases/reports";

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: z.object({
    subjectType: z.enum(["post", "comment", "message", "user", "room"]),
    subjectId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
  handler: ({ deps, viewer, body }) => fileReport(deps, deps.db, viewer, body),
});
