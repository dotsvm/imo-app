/**
 * In-memory runtime adapters: a controllable clock, a capturing logger,
 * secrets from a map and an in-process token bucket. The limiter is also the
 * real one for a single worker; a shared Redis bucket replaces it when the
 * worker scales out.
 */
import type {
  Clock,
  LogFields,
  Logger,
  RateLimiter,
  SecretReader,
} from "@imo/core/ports/runtime";

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to. */
export class ManualClock implements Clock {
  private ms: number;
  constructor(start: string | number | Date = "2026-09-25T14:26:00Z") {
    this.ms = new Date(start).getTime();
  }
  now() {
    return new Date(this.ms);
  }
  advance(ms: number) {
    this.ms += ms;
  }
  set(at: string | number | Date) {
    this.ms = new Date(at).getTime();
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogLine extends LogFields {
  level: LogLevel;
  message: string;
  at: string;
}

const ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Structured logger writing to any sink: JSON lines to stdout in production,
    an array in tests. */
export function createLogger(
  sink: (line: LogLine) => void,
  options: { level?: LogLevel; fields?: LogFields; clock?: Clock } = {},
): Logger {
  const { level = "info", fields = {}, clock = systemClock } = options;
  const write = (lineLevel: LogLevel, message: string, extra?: LogFields) => {
    if (ORDER[lineLevel] < ORDER[level]) return;
    sink({
      ...fields,
      ...extra,
      level: lineLevel,
      message,
      at: clock.now().toISOString(),
    });
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (more) =>
      createLogger(sink, { level, clock, fields: { ...fields, ...more } }),
  };
}

export const jsonStdoutLogger = (level: LogLevel = "info") =>
  createLogger((line) => console.log(JSON.stringify(line)), { level });

export function memorySecrets(
  values: Record<string, string> = {},
): SecretReader {
  return { get: async (name) => values[name] };
}

export interface Budget {
  /** Tokens added per second. */
  perSecond: number;
  /** Most tokens the bucket holds — the burst. */
  capacity: number;
}

/** Token buckets per key. Unknown keys are a configuration error. */
export class TokenBucketLimiter implements RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly budgets: Record<string, Budget>,
    private readonly clock: Clock = systemClock,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** A budget for the key, or for its prefix: "api:write:user-1" uses the
      "api:write" budget, with a bucket of its own. */
  private budgetFor(key: string) {
    for (
      let k = key;
      k;
      k = k.includes(":") ? k.slice(0, k.lastIndexOf(":")) : ""
    )
      if (this.budgets[k]) return this.budgets[k];
    return undefined;
  }

  private bucket(key: string) {
    const budget = this.budgetFor(key);
    if (!budget) throw new RangeError(`No rate budget configured for "${key}"`);
    const now = this.clock.now().getTime();
    let state = this.buckets.get(key);
    if (!state) {
      state = { tokens: budget.capacity, at: now };
      this.buckets.set(key, state);
    }
    const refill = ((now - state.at) / 1000) * budget.perSecond;
    state.tokens = Math.min(budget.capacity, state.tokens + refill);
    state.at = now;
    return { state, budget };
  }

  async tryAcquire(key: string, cost = 1) {
    const { state, budget } = this.bucket(key);
    if (cost > budget.capacity)
      throw new RangeError(`A cost of ${cost} can never fit "${key}"`);
    if (state.tokens < cost) return false;
    state.tokens -= cost;
    return true;
  }

  async acquire(key: string, cost = 1) {
    while (!(await this.tryAcquire(key, cost))) {
      const { state, budget } = this.bucket(key);
      const wait = ((cost - state.tokens) / budget.perSecond) * 1000;
      await this.sleep(Math.max(1, Math.ceil(wait)));
    }
  }
}
