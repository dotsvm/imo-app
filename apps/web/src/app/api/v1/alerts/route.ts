import { z } from "zod";
import { route } from "@imo/server/http/route";
import { createAlert, listAlerts } from "@imo/server/usecases/alerts";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => listAlerts(deps.db, viewer),
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: z.object({
    market: z.string().min(1).max(120),
    outcome: z.enum(["Yes", "No"]),
    thresholdCents: z.number().int().min(1).max(99),
    direction: z.enum(["above", "below"]),
  }),
  handler: ({ deps, viewer, body }) => createAlert(deps.db, viewer, body),
});
