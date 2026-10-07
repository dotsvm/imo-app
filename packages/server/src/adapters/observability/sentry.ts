/**
 * Errors to Sentry, over its envelope endpoint — no SDK, so nothing runs at
 * import time and the egress allowlist applies. Fire-and-forget: reporting
 * never slows or fails the request it describes. The same error repeating is
 * sent once a minute, not once per request.
 */
import { randomUUID } from "node:crypto";
import type { Clock, ErrorReporter, HttpClient, Logger } from "@imo/core/ports/runtime";

export function parseDsn(dsn: string) {
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!url.username || !projectId) throw new Error("SENTRY_DSN isn't a DSN");
  return { key: url.username, host: url.host, projectId, endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/` };
}

const frames = (stack?: string) =>
  (stack ?? "")
    .split("\n")
    .slice(1, 40)
    .map((line) => {
      const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      return m ? { function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : { function: line.trim() };
    })
    .reverse();

export class SentryReporter implements ErrorReporter {
  private readonly dsn: ReturnType<typeof parseDsn>;
  private readonly recent = new Map<string, number>();
  private inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly http: HttpClient,
    dsn: string,
    private readonly clock: Clock,
    private readonly log: Logger,
    private readonly meta: { environment: string; release?: string; serverName?: string },
  ) {
    this.dsn = parseDsn(dsn);
  }

  capture(error: unknown, context: Parameters<ErrorReporter["capture"]>[1] = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    const fingerprint = `${err.name}:${err.message}`;
    const now = this.clock.now().getTime();
    if ((this.recent.get(fingerprint) ?? 0) > now - 60_000) return;
    if (this.recent.size > 500) this.recent.clear();
    this.recent.set(fingerprint, now);

    const eventId = randomUUID().replace(/-/g, "");
    const event = {
      event_id: eventId,
      timestamp: now / 1000,
      platform: "node",
      level: "error",
      environment: this.meta.environment,
      release: this.meta.release,
      server_name: this.meta.serverName,
      exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: frames(err.stack) } }] },
      tags: { ...context.tags, ...(context.requestId && { request_id: context.requestId }) },
      extra: context.extra,
      user: context.userId ? { id: context.userId } : undefined,
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    const sending = this.http
      .json(this.dsn.endpoint, {
        method: "POST",
        headers: { "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${this.dsn.key}, sentry_client=hunch/1.0` },
        rawBody: { contentType: "application/x-sentry-envelope", text: envelope },
        timeoutMs: 5_000,
      })
      .catch((e: unknown) => this.log.warn("error report not sent", { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => this.inflight.delete(sending));
    this.inflight.add(sending);
  }

  async flush() {
    await Promise.allSettled([...this.inflight]);
  }
}

/** Without Sentry: errors are logged (they already are) and nothing else. */
export class LogReporter implements ErrorReporter {
  readonly captured: { error: unknown; context?: unknown }[] = [];
  capture(error: unknown, context?: unknown) {
    this.captured.push({ error, context });
    if (this.captured.length > 100) this.captured.shift();
  }
  async flush() {}
}
