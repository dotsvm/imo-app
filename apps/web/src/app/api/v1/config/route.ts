import { route } from "@imo/server/http/route";
import { clientConfig } from "@imo/server/usecases/client-config";

export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:read",
  handler: async ({ deps }) => clientConfig(deps),
});
