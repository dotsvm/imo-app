import { route } from "@imo/server/http/route";
import { waitlistConfig } from "@imo/server/usecases/client-config";

/** What the waitlist page needs to sign someone in: its ways in, and
    Supabase's public address and key. Nothing more. */
export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:read",
  handler: async ({ deps }) => waitlistConfig(deps),
});
