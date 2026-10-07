/**
 * Product analytics to PostHog, batched: events queue in memory and go in one
 * request every few seconds (or when fifty pile up). Server-side only here;
 * the browser runs PostHog's own snippet with the public key.
 */
import type { Analytics, Clock, HttpClient, Logger } from "@imo/core/ports/runtime";

interface Queued {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export class PostHogAnalytics implements Analytics {
  private queue: Queued[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private readonly endpoint: string;

  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
    host: string,
    private readonly clock: Clock,
    private readonly log: Logger,
    private readonly flushEveryMs = 5_000,
  ) {
    this.endpoint = `${host.replace(/\/+$/, "")}/batch/`;
  }

  capture(event: string, distinctId: string, properties: Record<string, unknown> = {}) {
    this.queue.push({ event, distinct_id: distinctId, properties: { ...properties, $lib: "hunch-server" }, timestamp: this.clock.now().toISOString() });
    if (this.queue.length >= 50) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.flushEveryMs);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.queue.splice(0, this.queue.length);
    if (!batch.length) return;
    await this.http
      .json(this.endpoint, { method: "POST", body: { api_key: this.apiKey, batch }, timeoutMs: 10_000 })
      .catch((e: unknown) => this.log.warn("analytics batch dropped", { events: batch.length, error: e instanceof Error ? e.message : String(e) }));
  }
}

/** Without PostHog: events are counted in memory (tests read them). */
export class MemoryAnalytics implements Analytics {
  readonly events: { event: string; distinctId: string; properties?: Record<string, unknown> }[] = [];
  capture(event: string, distinctId: string, properties?: Record<string, unknown>) {
    this.events.push({ event, distinctId, properties });
    if (this.events.length > 1_000) this.events.shift();
  }
  async flush() {}
}
