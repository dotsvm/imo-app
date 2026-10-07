/**
 * A job queue on Postgres: `FOR UPDATE SKIP LOCKED` lets any number of worker
 * replicas claim jobs without stepping on each other, and a job can be
 * enqueued inside the same transaction as the change that needs it.
 *
 * At-least-once: a worker that dies mid-job leaves a lock that expires, and
 * the job runs again. Handlers must be idempotent.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Job, JobOptions, JobQueue } from "@imo/core/ports/platform";
import type { Clock } from "@imo/core/ports/runtime";
import type { Db, Queryable } from "../../db/client";
import { jobs } from "../../db/schema";

export interface PgJobQueueOptions {
  /** How long a claimed job is locked before another worker may retry it. */
  lockMs?: number;
  batch?: number;
  backoffMs?: (attempt: number) => number;
}

export class PgJobQueue implements JobQueue {
  private handlers = new Map<string, (job: Job) => Promise<void>>();
  /** Jobs this instance saw die, for tests and alerts. */
  readonly dead: Job[] = [];
  private readonly lockMs: number;
  private readonly batch: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    options: PgJobQueueOptions = {},
  ) {
    this.lockMs = options.lockMs ?? 60_000;
    this.batch = options.batch ?? 10;
    this.backoffMs = options.backoffMs ?? ((attempt) => 2 ** attempt * 1000);
  }

  /** Enqueue with any connection — pass a transaction to commit the job with
      the change that caused it. */
  async enqueueWith<P>(
    q: Queryable,
    name: string,
    payload: P,
    options: JobOptions = {},
  ): Promise<string | null> {
    const rows = await q
      .insert(jobs)
      .values({
        name,
        payload: payload as unknown,
        key: options.key ?? null,
        runAt: options.runAt ?? this.clock.now(),
        maxAttempts: options.attempts ?? 5,
      })
      .onConflictDoNothing({
        target: jobs.key,
        where: sql`key is not null and status in ('pending', 'running')`,
      })
      .returning({ id: jobs.id });
    return rows[0]?.id ?? null;
  }

  enqueue<P>(name: string, payload: P, options?: JobOptions) {
    return this.enqueueWith(this.db, name, payload, options);
  }

  work<P>(name: string, handler: (job: Job<P>) => Promise<void>) {
    this.handlers.set(name, handler as (job: Job) => Promise<void>);
    return () => void this.handlers.delete(name);
  }

  /** Claim and run every due job this instance has a handler for. */
  async drain() {
    const names = [...this.handlers.keys()];
    if (!names.length) return { ran: 0, waiting: 0 };
    const now = this.clock.now();
    // Locks that outlived their worker become claimable again.
    await this.db
      .update(jobs)
      .set({ status: "pending", lockedUntil: null })
      .where(and(eq(jobs.status, "running"), lte(jobs.lockedUntil, now)));
    const claimed = await this.db.execute<{
      id: string;
      name: string;
      payload: unknown;
      attempts: number;
      max_attempts: number;
    }>(sql`
      update jobs set status = 'running', attempts = attempts + 1,
        locked_until = ${new Date(now.getTime() + this.lockMs).toISOString()}::timestamptz
      where id in (
        select id from jobs
        where status = 'pending' and run_at <= ${now.toISOString()}::timestamptz
          and name in ${names}
        order by run_at
        limit ${this.batch}
        for update skip locked
      )
      returning id, name, payload, attempts, max_attempts`);
    let ran = 0;
    for (const row of claimed) {
      const job: Job = {
        id: row.id,
        name: row.name,
        payload: row.payload,
        attempt: row.attempts,
      };
      try {
        await this.handlers.get(row.name)!(job);
        await this.db
          .update(jobs)
          .set({
            status: "done",
            finishedAt: this.clock.now(),
            lockedUntil: null,
          })
          .where(eq(jobs.id, row.id));
        ran++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const dead = row.attempts >= row.max_attempts;
        await this.db
          .update(jobs)
          .set(
            dead
              ? {
                  status: "dead",
                  lastError: message,
                  finishedAt: this.clock.now(),
                  lockedUntil: null,
                }
              : {
                  status: "pending",
                  lastError: message,
                  lockedUntil: null,
                  runAt: new Date(
                    this.clock.now().getTime() + this.backoffMs(row.attempts),
                  ),
                },
          )
          .where(eq(jobs.id, row.id));
        if (dead) this.dead.push(job);
      }
    }
    const [{ waiting }] = await this.db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from jobs where status = 'pending'`,
    );
    return { ran, waiting };
  }

  /** Drop finished jobs older than `ms`. */
  async prune(ms: number) {
    await this.db
      .delete(jobs)
      .where(
        and(
          inArray(jobs.status, ["done"]),
          lte(jobs.finishedAt, new Date(this.clock.now().getTime() - ms)),
        ),
      );
  }
}
