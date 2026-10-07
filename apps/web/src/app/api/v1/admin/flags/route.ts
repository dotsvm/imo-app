import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { listFlags } from "@imo/server/usecases/admin";

export const GET = route({ ...admin, limit: "api:read", handler: ({ deps }) => listFlags(deps.db) });
