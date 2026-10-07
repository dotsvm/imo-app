/**
 * Uploads on stores the API serves itself (local disk). With Supabase
 * Storage, tickets point at Supabase and these answer 404.
 */
import { z } from "zod";
import { ApiError, notFound } from "@imo/server/errors";
import { route } from "@imo/server/http/route";

const Params = z.object({ key: z.array(z.string().max(200)).min(2).max(6).transform((parts) => parts.join("/")) });

export const PUT = route({
  auth: "none",
  gate: false,
  limit: "api:write",
  params: Params,
  query: z.object({ token: z.string().max(300) }),
  handler: async ({ deps, params, query, request }) => {
    const serve = deps.storage.serve;
    if (!serve || !request.body) throw notFound("That upload");
    try {
      const stored = await serve.accept(
        params.key,
        query.token,
        request.headers.get("content-type") ?? "",
        request.body,
      );
      return { key: params.key, ...stored };
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400, "upload_refused", error.message);
      throw error;
    }
  },
});

export const GET = route({
  auth: "none",
  gate: false,
  params: Params,
  handler: async ({ deps, params }) => {
    let object;
    try {
      object = await deps.storage.serve?.open(params.key);
    } catch {
      object = null;
    }
    if (!object) throw notFound("That file");
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "content-length": String(object.bytes),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  },
});
