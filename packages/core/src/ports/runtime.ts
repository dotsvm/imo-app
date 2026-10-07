/**
 * Runtime ports every adapter receives. Interfaces only: the composition root
 * decides what backs them (real clocks and sockets in production, fakes in
 * tests and the demo).
 */

export interface Clock {
  now(): Date;
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line — e.g. `{ venue, source }`. */
  child(fields: LogFields): Logger;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
  }
  /** 408, 425, 429 and 5xx are worth retrying; other statuses aren't. */
  get retryable() {
    return (
      this.status === 408 ||
      this.status === 425 ||
      this.status === 429 ||
      this.status >= 500
    );
  }
}

export interface HttpRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** Serialized as JSON. */
  body?: unknown;
  /** A body that isn't JSON (Sentry envelopes), sent as-is. */
  rawBody?: { contentType: string; text: string };
  timeoutMs?: number;
  /** Safe to retry after a timeout or a retryable status. GETs are by default. */
  idempotent?: boolean;
}

/**
 * The only way adapters reach the network. Implementations add timeouts,
 * jittered retries for idempotent calls, a circuit breaker per host, tracing
 * and the egress allowlist. Responses come back as `unknown`: adapters parse
 * them with their own schemas.
 */
export interface HttpClient {
  json(url: string, request?: HttpRequest): Promise<unknown>;
}

/** Token buckets keyed by budget ("kalshi:read"), shared across replicas. */
export interface RateLimiter {
  /** Wait until `cost` tokens are available, then spend them. */
  acquire(key: string, cost?: number): Promise<void>;
  /** Spend `cost` tokens now if they're available. */
  tryAcquire(key: string, cost?: number): Promise<boolean>;
}

/** Deployment secrets: venue API keys and the like. */
export interface SecretReader {
  get(name: string): Promise<string | undefined>;
}

/** Where unexpected errors go: never user mistakes, only our own failures. */
export interface ErrorReporter {
  capture(
    error: unknown,
    context?: {
      requestId?: string;
      userId?: string;
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ): void;
  /** Send what's queued (before a process exits). */
  flush(): Promise<void>;
}

/** Product analytics from the server: what people did, not what they typed. */
export interface Analytics {
  capture(event: string, distinctId: string, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
}
