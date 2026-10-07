/**
 * Token buckets in Postgres, shared by every instance: one atomic upsert per
 * request refills the bucket for the time that passed and spends from it, or
 * leaves it alone and says no. For deployments without Redis.
 */
import { eq, lt, sql } from "drizzle-orm";
import type { Clock, RateLimiter } from "@imo/core/ports/runtime";
import type { Budget } from "../memory/runtime";
import type { Db } from "../../db/client";
import { rateBuckets } from "../../db/schema";

export class PgRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly budgets: Record<string, Budget>,
    private readonly clock: Clock,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** "api:write:user-1" spends from the "api:write" budget, in its own bucket. */
  private budgetFor(key: string) {
    for (let k = key; k; k = k.includes(":") ? k.slice(0, k.lastIndexOf(":")) : "")
      if (this.budgets[k]) return this.budgets[k];
    throw new RangeError(`No rate budget configured for "${key}"`);
  }

  async tryAcquire(key: string, cost = 1) {
    const budget = this.budgetFor(key);
    if (cost > budget.capacity) throw new RangeError(`A cost of ${cost} can never fit "${key}"`);
    const now = this.clock.now().toISOString();
    const refilled = sql`least(${budget.capacity}::float8,
      ${rateBuckets.tokens} + greatest(0, extract(epoch from (${now}::timestamptz - ${rateBuckets.updatedAt}))) * ${budget.perSecond}::float8)`;
    const rows = await this.db
      .insert(rateBuckets)
      .values({ key, tokens: budget.capacity - cost, updatedAt: new Date(now) })
      .onConflictDoUpdate({
        target: rateBuckets.key,
        set: { tokens: sql`${refilled} - ${cost}::float8`, updatedAt: new Date(now) },
        setWhere: sql`${refilled} >= ${cost}::float8`,
      })
      .returning({ tokens: rateBuckets.tokens });
    return rows.length > 0;
  }

  async acquire(key: string, cost = 1) {
    const budget = this.budgetFor(key);
    while (!(await this.tryAcquire(key, cost))) {
      const [row] = await this.db.select().from(rateBuckets).where(eq(rateBuckets.key, key));
      const tokens = row ? row.tokens : budget.capacity;
      await this.sleep(Math.max(1, Math.ceil(((cost - tokens) / budget.perSecond) * 1000)));
    }
  }

  /** Forget buckets idle for a day (the worker's prune lane). */
  async prune() {
    await this.db.delete(rateBuckets).where(lt(rateBuckets.updatedAt, new Date(this.clock.now().getTime() - 86_400_000)));
  }
}
