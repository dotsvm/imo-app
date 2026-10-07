import { route } from "@imo/server/http/route";
import { ProfilePatch } from "@imo/server/http/people-schemas";
import { betaStatus } from "@imo/server/usecases/beta";
import { getMe } from "@imo/server/usecases/me";
import { updateProfile } from "@imo/server/usecases/people";
import { ensureWallets } from "@imo/server/usecases/viewer";

export const GET = route({
  auth: "required",
  gate: false,
  limit: "api:read",
  handler: async ({ deps, viewer }) => {
    // Wallets that never arrived (a provider outage) are asked for again.
    await ensureWallets(deps, deps.db, viewer);
    return { ...(await getMe(deps.db, viewer)), access: await betaStatus(deps, viewer) };
  },
});

/** Your profile and settings; answers with the updated `me`. */
export const PATCH = route({
  auth: "required",
  gate: false,
  limit: "api:write",
  body: ProfilePatch,
  handler: async ({ deps, viewer, body }) => {
    await updateProfile(deps, deps.db, viewer, body);
    return { ...(await getMe(deps.db, viewer)), access: await betaStatus(deps, viewer) };
  },
});
