/**
 * Realtime on plain Postgres: publishers NOTIFY, and each web process holds
 * one LISTEN connection that fans messages out to its SSE clients. For local
 * development and self-hosting; production on Supabase uses Broadcast.
 *
 * LISTEN needs a session connection, so pass a direct URL — never one behind
 * a transaction pooler. NOTIFY payloads are capped at 8,000 bytes: realtime
 * messages say what changed, and clients fetch the rest.
 */
import postgres from "postgres";
import type {
  Channel,
  RealtimeFeed,
  RealtimeMessage,
  RealtimePublisher,
} from "@imo/core/ports/platform";
import type { Logger } from "@imo/core/ports/runtime";

const PG_CHANNEL = "hunch_realtime";
const MAX_PAYLOAD = 7_900;

export class PgRealtime implements RealtimePublisher, RealtimeFeed {
  private readonly sql: postgres.Sql;
  private listening_?: Promise<unknown>;
  private listeners = new Set<{
    channels: ReadonlySet<Channel>;
    handler: (message: RealtimeMessage) => void;
  }>();

  constructor(
    url: string,
    private readonly log: Logger,
  ) {
    this.sql = postgres(url, {
      max: 2,
      onnotice: () => {},
      connection: { application_name: "hunch-realtime" },
    });
  }

  async publish(channel: Channel, event: string, payload: unknown) {
    const text = JSON.stringify({ channel, event, payload });
    if (text.length > MAX_PAYLOAD) {
      // Too big to carry: tell listeners to refetch instead.
      await this.sql.notify(
        PG_CHANNEL,
        JSON.stringify({ channel, event, payload: { truncated: true } }),
      );
      this.log.warn("realtime payload truncated", { channel, event });
      return;
    }
    await this.sql.notify(PG_CHANNEL, text);
  }

  subscribe(
    channels: readonly Channel[],
    handler: (message: RealtimeMessage) => void,
  ) {
    this.listening_ ??= this.sql
      .listen(PG_CHANNEL, (raw) => this.dispatch(raw))
      .catch((error: unknown) => {
        this.listening_ = undefined;
        this.log.error("realtime listen failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    const listener = { channels: new Set(channels), handler };
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Resolves once this process is listening (subscribing starts it). */
  async listening() {
    await this.listening_;
  }

  private dispatch(raw: string) {
    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw) as RealtimeMessage;
    } catch {
      return;
    }
    for (const listener of this.listeners)
      if (listener.channels.has(message.channel)) listener.handler(message);
  }

  close() {
    return this.sql.end({ timeout: 5 });
  }
}
