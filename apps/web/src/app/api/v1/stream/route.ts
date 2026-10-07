/**
 * Server-sent events for deployments that relay realtime through the API
 * (Postgres LISTEN/NOTIFY). Deployments on Supabase Realtime answer 404 here;
 * GET /api/v1/config says which transport to use.
 *
 *   GET /api/v1/stream?channels=market:fed-dec,user:me
 */
import { z } from "zod";
import { ApiError } from "@imo/server/errors";
import { route } from "@imo/server/http/route";
import { authorizeChannels } from "@imo/server/usecases/realtime";

const KEEP_ALIVE_MS = 15_000;

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: z.object({ channels: z.string().min(1).max(2_000) }),
  handler: async ({ deps, viewer, query, request }) => {
    const feed = deps.realtimeFeed;
    if (!feed)
      throw new ApiError(404, "not_found", "Realtime here comes from the provider named in /api/v1/config.");
    const allowed = await authorizeChannels(deps.db, viewer, query.channels.split(","));
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        send(`retry: 3000\n\n`);
        send(`event: ready\ndata: ${JSON.stringify({ channels: allowed })}\n\n`);
        const unsubscribe = feed.subscribe(allowed, (message) =>
          send(`event: ${message.event}\ndata: ${JSON.stringify({ channel: message.channel, payload: message.payload })}\n\n`),
        );
        const keepAlive = setInterval(() => send(`: keep-alive\n\n`), KEEP_ALIVE_MS);
        cleanup = () => {
          clearInterval(keepAlive);
          unsubscribe();
          cleanup = () => {};
        };
        request.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  },
});
