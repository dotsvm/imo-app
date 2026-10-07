/**
 * Supabase Realtime Broadcast, sent from the server over REST. Browsers
 * subscribe to the same topics with supabase-js; user and room topics are
 * private, authorized by the `hunch_listen` policy on realtime.messages
 * (packages/server/drizzle/0006_realtime.sql).
 */
import {
  isPrivateChannel,
  type Channel,
  type RealtimePublisher,
} from "@imo/core/ports/platform";
import type { HttpClient } from "@imo/core/ports/runtime";

export class SupabaseBroadcast implements RealtimePublisher {
  private readonly endpoint: string;
  constructor(
    private readonly http: HttpClient,
    url: string,
    private readonly secretKey: string,
  ) {
    this.endpoint = `${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`;
  }

  async publish(channel: Channel, event: string, payload: unknown) {
    await this.http.json(this.endpoint, {
      method: "POST",
      // The gateway accepts the secret key as `apikey`; it isn't a JWT, so it
      // never goes in Authorization.
      headers: { apikey: this.secretKey },
      body: {
        messages: [
          {
            topic: channel,
            event,
            payload,
            private: isPrivateChannel(channel),
          },
        ],
      },
      timeoutMs: 5_000,
      idempotent: true,
    });
  }
}
