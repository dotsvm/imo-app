/**
 * The cache port on Postgres: an unlogged table read by key and expiry. For
 * deployments without Redis; Upstash takes over when configured.
 */
import { and, eq, gt, lte } from "drizzle-orm";
import type { Cache } from "@imo/core/ports/platform";
import type { Clock } from "@imo/core/ports/runtime";
import type { Db } from "../../db/client";
import { cacheEntries } from "../../db/schema";

export class PgCache implements Cache {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async get<T>(key: string) {
    const [row] = await this.db
      .select({ value: cacheEntries.value })
      .from(cacheEntries)
      .where(and(eq(cacheEntries.key, key), gt(cacheEntries.expiresAt, this.clock.now())));
    return row ? (row.value as T) : undefined;
  }

  async set<T>(key: string, value: T, ttlSeconds: number) {
    if (!(ttlSeconds > 0)) throw new RangeError("TTL must be positive");
    const expiresAt = new Date(this.clock.now().getTime() + ttlSeconds * 1000);
    await this.db
      .insert(cacheEntries)
      .values({ key, value: value as unknown, expiresAt })
      .onConflictDoUpdate({ target: cacheEntries.key, set: { value: value as unknown, expiresAt } });
  }

  async delete(key: string) {
    await this.db.delete(cacheEntries).where(eq(cacheEntries.key, key));
  }

  /** Drop what has expired (the worker's prune lane). */
  async prune() {
    await this.db.delete(cacheEntries).where(lte(cacheEntries.expiresAt, this.clock.now()));
  }
}
