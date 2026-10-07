/**
 * Email a sign-in link, sent from our own server so the browser never needs
 * Supabase's address or key. The link opens on this browser (its verifier is
 * a cookie here), comes back through /api/v1/auth/callback, then on to `next`.
 *
 *   POST /api/v1/auth/email  { email, next }
 */
import { z } from "zod";
import { safeNext, signInReturn } from "@imo/core/paths";
import { invalid, rateLimited, unavailable } from "@imo/server/errors";
import { route } from "@imo/server/http/route";

export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  status: 202,
  body: z.object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(320),
    next: z.string().max(2_000).optional(),
  }),
  handler: async ({ deps, request, body, credentials, requestId }) => {
    const on = (await deps.identity.signInMethods?.()) ?? {};
    if (!deps.identity.sendSignInLink || on.email === false)
      throw unavailable("Email sign-in isn’t set up here.");
    try {
      await deps.identity.sendSignInLink(body.email, signInReturn(request.nextUrl.origin, safeNext(body.next)), credentials);
    } catch (error) {
      const status = (error as { status?: number }).status;
      deps.log.warn("sign-in link not sent", {
        requestId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      if (status === 429) throw rateLimited("Too many sign-in emails just now. Try again in a minute.");
      throw invalid("We couldn’t send a link to that address. Check it and try again.");
    }
    return { sent: true };
  },
});
