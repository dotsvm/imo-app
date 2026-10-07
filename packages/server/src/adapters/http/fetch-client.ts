/**
 * The production HttpClient. Every outbound call from every adapter goes
 * through it, so these guarantees hold everywhere:
 *
 * - Only allowlisted hosts are reachable (egress control).
 * - Every call has a timeout.
 * - Idempotent calls retry with full-jitter backoff, honoring Retry-After.
 * - A host that keeps failing trips a circuit breaker: calls fail fast until
 *   a cooldown passes, then a single probe decides whether it's healthy.
 * - Responses are size-limited and must be JSON.
 */
import {
  HttpError,
  type Clock,
  type HttpClient,
  type HttpRequest,
  type Logger,
} from "@imo/core/ports/runtime";

export class EgressDenied extends Error {
  constructor(readonly host: string) {
    super(`Outbound calls to ${host} are not allowlisted`);
    this.name = "EgressDenied";
  }
}

export class CircuitOpen extends Error {
  constructor(
    readonly host: string,
    readonly retryAt: number,
  ) {
    super(
      `${host} is failing; calls are paused until ${new Date(retryAt).toISOString()}`,
    );
    this.name = "CircuitOpen";
  }
}

export interface FetchClientOptions {
  /** Hosts we may call: "api.example.com", or "*.example.com" for subdomains. */
  allow: readonly string[];
  log: Logger;
  clock: Clock;
  timeoutMs?: number;
  /** Tries for an idempotent call, including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failures that open a host's circuit. */
  breakAfter?: number;
  cooldownMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Breaker {
  failures: number;
  openUntil: number;
  probing: boolean;
}

export function createFetchClient(options: FetchClientOptions): HttpClient {
  const {
    allow,
    log,
    clock,
    timeoutMs = 10_000,
    attempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 8_000,
    breakAfter = 5,
    cooldownMs = 30_000,
    maxBytes = 5_000_000,
    fetch: doFetch = globalThis.fetch,
    random = Math.random,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const breakers = new Map<string, Breaker>();

  const allowed = (host: string) =>
    allow.some((rule) =>
      rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : host === rule,
    );

  const breakerFor = (host: string) => {
    let breaker = breakers.get(host);
    if (!breaker) {
      breaker = { failures: 0, openUntil: 0, probing: false };
      breakers.set(host, breaker);
    }
    return breaker;
  };

  async function once(url: URL, request: HttpRequest) {
    const response = await doFetch(url, {
      method: request.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(request.body !== undefined && {
          "content-type": "application/json",
        }),
        ...(request.rawBody && { "content-type": request.rawBody.contentType }),
        ...request.headers,
      },
      body: request.rawBody
        ? request.rawBody.text
        : request.body === undefined
          ? undefined
          : JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? timeoutMs),
      redirect: "error",
    });
    const text = await response.text();
    if (text.length > maxBytes)
      throw new Error(`Response from ${url.host} exceeds ${maxBytes} bytes`);
    if (!response.ok) {
      const error = new HttpError(
        response.status,
        url.toString(),
        text.slice(0, 500),
      );
      const retryAfter = Number(response.headers.get("retry-after"));
      throw Object.assign(error, {
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : undefined,
      });
    }
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Response from ${url.host} is not JSON`);
    }
  }

  const transient = (error: unknown) =>
    error instanceof HttpError
      ? error.retryable
      : error instanceof Error &&
        (error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          error instanceof TypeError); // network failures surface as TypeError

  return {
    async json(target, request = {}) {
      const url = new URL(target);
      if (
        url.protocol !== "https:" &&
        url.hostname !== "127.0.0.1" &&
        url.hostname !== "localhost"
      )
        throw new EgressDenied(`${url.protocol}//${url.host}`);
      if (!allowed(url.hostname)) throw new EgressDenied(url.hostname);
      const breaker = breakerFor(url.hostname);
      const now = clock.now().getTime();
      if (breaker.openUntil > now)
        throw new CircuitOpen(url.hostname, breaker.openUntil);
      if (breaker.openUntil && breaker.probing)
        throw new CircuitOpen(url.hostname, now + cooldownMs);
      const halfOpen = breaker.openUntil !== 0;
      if (halfOpen) breaker.probing = true;

      const idempotent =
        request.idempotent ?? (request.method ?? "GET") === "GET";
      const tries = idempotent && !halfOpen ? attempts : 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= tries; attempt++) {
        const started = clock.now().getTime();
        try {
          const body = await once(url, request);
          breaker.failures = 0;
          breaker.openUntil = 0;
          breaker.probing = false;
          log.debug("http ok", {
            host: url.hostname,
            path: url.pathname,
            ms: clock.now().getTime() - started,
          });
          return body;
        } catch (error) {
          lastError = error;
          const retry = transient(error);
          log.warn("http failed", {
            host: url.hostname,
            path: url.pathname,
            attempt,
            status: error instanceof HttpError ? error.status : undefined,
            error: (error as Error).message,
          });
          if (!retry) break;
          if (attempt < tries) {
            const hinted = (error as { retryAfterMs?: number }).retryAfterMs;
            const ceiling = Math.min(
              maxDelayMs,
              baseDelayMs * 2 ** (attempt - 1),
            );
            await sleep(hinted ?? Math.floor(random() * ceiling));
          }
        }
      }
      // Only failures that say something about the host's health count. A
      // definite answer like 404 means the host is up.
      if (transient(lastError)) {
        breaker.failures++;
        if (halfOpen || breaker.failures >= breakAfter) {
          breaker.openUntil = clock.now().getTime() + cooldownMs;
          log.error("circuit opened", {
            host: url.hostname,
            failures: breaker.failures,
          });
        }
      } else if (lastError instanceof HttpError) {
        breaker.failures = 0;
        breaker.openUntil = 0;
      }
      breaker.probing = false;
      throw lastError;
    },
  };
}
