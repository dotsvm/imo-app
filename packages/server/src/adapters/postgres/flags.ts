/**
 * Feature flags in Postgres, so an admin can flip one without a deploy.
 * Read through a short cache; a flag with no row takes its default.
 */
import type { FeatureFlags, FlagContext } from "@imo/core/ports/platform";
import type { Clock } from "@imo/core/ports/runtime";
import type { Db } from "../../db/client";
import { flags as flagRows } from "../../db/schema";

type Row = typeof flagRows.$inferSelect;

export class PgFlags implements FeatureFlags {
  private rows = new Map<string, Row>();
  private loadedAt = -Infinity;
  private loading?: Promise<void>;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly defaults: Readonly<Record<string, boolean>> = {},
    private readonly ttlMs = 10_000,
  ) {}

  private async fresh() {
    if (this.clock.now().getTime() - this.loadedAt < this.ttlMs) return;
    this.loading ??= this.db
      .select()
      .from(flagRows)
      .then((rows) => {
        this.rows = new Map(rows.map((r) => [r.key, r]));
        this.loadedAt = this.clock.now().getTime();
      })
      .finally(() => {
        this.loading = undefined;
      });
    await this.loading;
  }

  /** Forget the cache: after an admin changes a flag. */
  invalidate() {
    this.loadedAt = -Infinity;
  }

  async enabled(flag: string, context: FlagContext = {}) {
    await this.fresh();
    const row = this.rows.get(flag);
    if (!row) return this.defaults[flag] ?? false;
    if (!row.enabled) return false;
    const rules = row.rules;
    if (!rules) return true;
    // Targeted: on only for the people, cohorts or venues it names.
    if (rules.users?.length && !(context.userId && rules.users.includes(context.userId))) return false;
    if (rules.cohorts?.length && !(context.cohort && rules.cohorts.includes(context.cohort))) return false;
    if (rules.venues?.length && !(context.venueId && rules.venues.includes(context.venueId))) return false;
    return true;
  }
}
