/**
 * Sign out of this browser: every session the request carries ends (a
 * Supabase session's refresh token is revoked) and its cookies are cleared.
 * A write, so another site can't sign someone out.
 */
import { route } from "@imo/server/http/route";

export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  handler: async ({ deps, credentials }) => {
    await deps.identity.signOut?.(credentials);
    return { ok: true };
  },
});
