/**
 * Live updates. The server says how to connect (GET /api/v1/config): its own
 * SSE stream, or Supabase Realtime. Either way screens get `(channel, event,
 * payload)` callbacks; the connection follows the set of channels in use and
 * reconnects on its own.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type Transport =
  | { kind: "supabase"; url: string; key: string }
  | { kind: "sse"; url: string }
  | { kind: "none" };

export type RealtimeHandler = (channel: string, event: string, payload: unknown) => void;

export interface RealtimeOptions {
  /** The viewer: Supabase topics name them where the SSE stream says "me". */
  userId?: string | null;
  /** The tab's Supabase client, for the Supabase transport. */
  supabase?: () => Promise<SupabaseClient>;
}

/** The same rule as the server's: people and rooms are private topics. */
const isPrivate = (topic: string) => topic.startsWith("user:") || topic.startsWith("room:");

export class RealtimeClient {
  private channels = new Map<string, number>();
  private source?: EventSource;
  private subscribed = new Map<string, RealtimeChannel>();
  private authorized = false;
  private closed = false;
  private reconnect?: ReturnType<typeof setTimeout>;
  private readonly events = [
    "quote",
    "book",
    "status",
    "resolved",
    "order",
    "portfolio",
    "notification",
    "message",
    "message.updated",
    "message.deleted",
    "member",
    "markets",
    "prediction",
    "comment",
  ];

  constructor(
    private readonly transport: Transport,
    private readonly handler: RealtimeHandler,
    private readonly options: RealtimeOptions = {},
  ) {}

  /** Listen while something needs it; returns the way to stop. */
  watch(channel: string) {
    this.channels.set(channel, (this.channels.get(channel) ?? 0) + 1);
    if (this.channels.get(channel) === 1) this.schedule();
    return () => {
      const n = (this.channels.get(channel) ?? 1) - 1;
      if (n > 0) this.channels.set(channel, n);
      else {
        this.channels.delete(channel);
        this.schedule();
      }
    };
  }

  /** Channel changes arrive in bursts (a page mounting): connect once after. */
  private schedule() {
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => this.connect(), 250);
  }

  private connect() {
    if (this.closed) return;
    if (this.transport.kind === "sse") this.connectSse(this.transport.url);
    else if (this.transport.kind === "supabase")
      void this.syncSupabase().catch(() => {
        // Realtime is an extra: screens still load and refresh without it.
      });
  }

  private connectSse(url: string) {
    this.source?.close();
    this.source = undefined;
    if (!this.channels.size) return;
    const source = new EventSource(`${url}?channels=${encodeURIComponent([...this.channels.keys()].join(","))}`, {
      withCredentials: true,
    });
    for (const event of this.events)
      source.addEventListener(event, (message) => {
        try {
          const { channel, payload } = JSON.parse((message as MessageEvent<string>).data) as { channel: string; payload: unknown };
          this.handler(channel, event, payload);
        } catch {
          // A malformed frame is skipped, not fatal.
        }
      });
    this.source = source;
  }

  /** Supabase topics are the server's channel names; subscribe to the ones in
      use, leave the rest. */
  private async syncSupabase() {
    if (!this.options.supabase) return;
    const client = await this.options.supabase();
    if (this.closed) return;
    const topic = (channel: string) =>
      channel === "user:me" && this.options.userId ? `user:${this.options.userId}` : channel;
    const wanted = new Set([...this.channels.keys()].map(topic).filter((t) => t !== "user:me"));
    for (const [name, channel] of this.subscribed)
      if (!wanted.has(name)) {
        this.subscribed.delete(name);
        void client.removeChannel(channel);
      }
    const joining = [...wanted].filter((name) => !this.subscribed.has(name));
    if (!joining.length) return;
    // Private topics are authorized by the session's token: set it before
    // the first join, or it goes out as anonymous.
    if (!this.authorized && joining.some(isPrivate)) {
      await client.realtime.setAuth();
      this.authorized = true;
    }
    for (const name of joining)
      this.subscribed.set(
        name,
        client
          .channel(name, { config: { private: isPrivate(name) } })
          .on("broadcast", { event: "*" }, (message: { event: string; payload?: unknown }) =>
            this.handler(name, message.event, message.payload),
          )
          .subscribe(),
      );
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnect);
    this.source?.close();
    this.channels.clear();
    const subscribed = [...this.subscribed.values()];
    this.subscribed.clear();
    if (subscribed.length && this.options.supabase)
      void this.options.supabase().then((client) => subscribed.forEach((c) => void client.removeChannel(c)));
  }
}
