/**
 * Upstash Redis over its REST API: the cache and shared token buckets, for
 * deployments that want them off the database. Commands go as JSON arrays.
 */
import type { Cache } from "@imo/core/ports/platform";
import type { Clock, HttpClient, RateLimiter } from "@imo/core/ports/runtime";
import type { Budget } from "../memory/runtime";

class UpstashClient {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string,
    private readonly token: string,
  ) {}

  async command<T>(...args: (string | number)[]): Promise<T> {
    const response = (await this.http.json(this.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body: args.map(String),
      timeoutMs: 3_000,
      idempotent: true,
    })) as { result?: T; error?: string };
    if (response?.error) throw new Error(`Upstash: ${response.error}`);
    return response?.result as T;
  }
}

export class UpstashCache implements Cache {
  private readonly redis: UpstashClient;
  constructor(http: HttpClient, url: string, token: string, private readonly prefix = "hunch:cache:") {
    this.redis = new UpstashClient(http, url, token);
  }
  async get<T>(key: string) {
    const raw = await this.redis.command<string | null>("GET", this.prefix + key);
    return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    if (!(ttlSeconds > 0)) throw new RangeError("TTL must be positive");
    await this.redis.command("SET", this.prefix + key, JSON.stringify(value), "PX", Math.ceil(ttlSeconds * 1000));
  }
  async delete(key: string) {
    await this.redis.command("DEL", this.prefix + key);
  }
}

/** Refill for the time that passed, then spend — atomically, in one script. */
const BUCKET = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local state = redis.call("HMGET", KEYS[1], "tokens", "at")
local tokens = tonumber(state[1]) or capacity
local at = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - at) / 1000 * rate)
local ok = 0
if tokens >= cost then
  tokens = tokens - cost
  ok = 1
end
redis.call("HSET", KEYS[1], "tokens", tostring(tokens), "at", tostring(now))
redis.call("PEXPIRE", KEYS[1], math.ceil(capacity / rate * 1000) + 60000)
return {ok, tostring(tokens)}`;

export class UpstashRateLimiter implements RateLimiter {
  private readonly redis: UpstashClient;
  constructor(
    http: HttpClient,
    url: string,
    token: string,
    private readonly budgets: Record<string, Budget>,
    private readonly clock: Clock,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly prefix = "hunch:rate:",
  ) {
    this.redis = new UpstashClient(http, url, token);
  }

  private budgetFor(key: string) {
    for (let k = key; k; k = k.includes(":") ? k.slice(0, k.lastIndexOf(":")) : "")
      if (this.budgets[k]) return this.budgets[k];
    throw new RangeError(`No rate budget configured for "${key}"`);
  }

  private async spend(key: string, cost: number) {
    const budget = this.budgetFor(key);
    if (cost > budget.capacity) throw new RangeError(`A cost of ${cost} can never fit "${key}"`);
    const [ok, tokens] = await this.redis.command<[number, string]>(
      "EVAL", BUCKET, 1, this.prefix + key, budget.capacity, budget.perSecond, cost, this.clock.now().getTime(),
    );
    return { ok: ok === 1, tokens: Number(tokens), budget };
  }

  async tryAcquire(key: string, cost = 1) {
    return (await this.spend(key, cost)).ok;
  }

  async acquire(key: string, cost = 1) {
    for (;;) {
      const { ok, tokens, budget } = await this.spend(key, cost);
      if (ok) return;
      await this.sleep(Math.max(1, Math.ceil(((cost - tokens) / budget.perSecond) * 1000)));
    }
  }
}
