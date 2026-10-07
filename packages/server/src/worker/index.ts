/**
 * The worker: everything that happens on a clock rather than on a request.
 * Each lane runs on its own interval; exclusive lanes run on one replica at a
 * time (leases), the rest are safe to run everywhere (SKIP LOCKED).
 *
 *   catalog:<source>   listings → markets, volumes, quotes; unlisted lookups
 *                      (source lanes run only while their venues may be shown)
 *   series:<source>    7-day sparklines for the most-seen markets
 *   status:<source>    venue trading status
 *   hot                books for watched markets and resting orders; matching
 *   trending           trending ranks and Hunch holder counts
 *   outbox             committed events → realtime, notifications, jobs
 *   jobs               queued work: settlement, email, wallet provisioning
 *   alerts             price alerts crossed since the last pass
 *   closing            holders told a day before a market closes
 *   equity             today's equity for every account (hourly upsert)
 *   stats              track records and the leaderboard's numbers
 *   digest             the daily email of predictions from people you follow
 *   wallet-orders      wallet orders in flight until they fill; unsigned builds expired
 *   settle-sweep       final results that have no settlement yet
 *   prune              finished jobs, relayed events, stale keys
 */
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import type { MailMessage } from "@imo/core/ports/platform";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { relayOutbox } from "../outbox";
import { deliver, relayHandlers } from "../relay";
import { closingSoon, fireAlerts } from "../usecases/alerts";
import { dueDigests } from "../usecases/digest";
import { refreshStats, snapshotEquity } from "../usecases/stats";
import {
  computeTrending,
  refreshHolders,
  refreshHotMarkets,
  refreshSeries,
  refreshVenueStatus,
} from "../usecases/books";
import { syncCatalog } from "../usecases/ingest";
import { settleMarket } from "../usecases/portfolio";
import { provisionWallets } from "../usecases/viewer";
import { syncInFlight } from "../usecases/wallet-trading";
import { releaseLease, takeLease } from "./leases";

export type WorkerDeps = Deps & { db: Db };

export interface Lane {
  name: string;
  everyMs: number;
  /** One replica at a time. */
  exclusive: boolean;
  run(now: Date): Promise<unknown>;
}

export interface WorkerOptions {
  /** This replica's name in leases: host and pid. */
  holder: string;
  /** Override lane intervals (tests, tuning), by lane name or prefix. */
  intervals?: Record<string, number>;
  /** How long stopping waits for lanes in flight before handing leases back. */
  stopGraceMs?: number;
}

const MINUTE = 60_000;

export function workerLanes(deps: WorkerDeps): Lane[] {
  const { db } = deps;
  const handlers = relayHandlers(deps);
  deps.jobs.work<{ marketId: string }>("markets.settle", async (job) => {
    await settleMarket(db, job.payload.marketId, deps.clock.now());
  });
  deps.jobs.work<MailMessage>("mail.send", async (job) => {
    await deps.mailer.send(job.payload);
  });
  deps.jobs.work<Parameters<typeof provisionWallets>[1]>("wallets.provision", async (job) => {
    await provisionWallets(deps, job.payload);
  });
  deps.jobs.work<{ key: string }>("storage.delete", async (job) => {
    await deps.storage.delete(job.payload.key);
  });

  const lanes: Lane[] = [];
  for (const sourceId of deps.venues.feeds) {
    // A venue's data is fetched only while Hunch may show it: display rights
    // in the registry, which stand for written consent where a venue's terms
    // ask for it (Kalshi's). Checked every run, so granting them takes effect
    // without a restart.
    const shown =
      (run: (now: Date) => Promise<unknown>) => async (now: Date) =>
        (await displayAllowed(db, deps.venues.served.get(sourceId) ?? []))
          ? run(now)
          : { skipped: "no display rights" };
    lanes.push(
      {
        name: `catalog:${sourceId}`,
        everyMs: 5 * MINUTE,
        exclusive: true,
        run: shown(() => syncCatalog(deps, db, sourceId)),
      },
      {
        name: `series:${sourceId}`,
        everyMs: 15 * MINUTE,
        exclusive: true,
        run: shown((now) => refreshSeries(deps, db, sourceId, now)),
      },
      {
        name: `status:${sourceId}`,
        everyMs: 30_000,
        exclusive: true,
        run: shown(() => refreshVenueStatus(deps, db, sourceId)),
      },
    );
  }
  lanes.push(
    {
      name: "hot",
      everyMs: 3_000,
      exclusive: true,
      run: (now) => refreshHotMarkets(deps, db, now),
    },
    {
      name: "trending",
      everyMs: 5 * MINUTE,
      exclusive: true,
      run: async (now) => {
        await refreshHolders(db);
        return computeTrending(db, now);
      },
    },
    {
      name: "outbox",
      everyMs: 500,
      exclusive: false,
      run: () => relayOutbox(db, handlers, 50),
    },
    {
      name: "jobs",
      everyMs: 1_000,
      exclusive: false,
      run: () => deps.jobs.drain(),
    },
    {
      name: "alerts",
      everyMs: 30_000,
      exclusive: true,
      run: async (now) => {
        const fired = await fireAlerts(db, now);
        for (const notice of fired) await deliver(deps, notice);
        return { fired: fired.length };
      },
    },
    {
      name: "closing",
      everyMs: 15 * MINUTE,
      exclusive: true,
      run: async (now) => {
        const notices = await closingSoon(db, now);
        let sent = 0;
        for (const notice of notices) if (await deliver(deps, notice)) sent++;
        return { sent };
      },
    },
    {
      name: "equity",
      everyMs: 60 * MINUTE,
      exclusive: true,
      run: (now) => snapshotEquity(db, now),
    },
    {
      name: "stats",
      everyMs: 15 * MINUTE,
      exclusive: true,
      run: (now) => refreshStats(db, now),
    },
    {
      name: "digest",
      everyMs: 10 * MINUTE,
      exclusive: true,
      run: async () => {
        const due = await dueDigests(deps, db);
        for (const message of due)
          await deps.jobs.enqueue("mail.send", message, { key: message.idempotencyKey });
        return { queued: due.length };
      },
    },
    {
      // Wallet orders: landed ones checked until they fill or fail, and
      // builds nobody signed expired.
      name: "wallet-orders",
      everyMs: 5_000,
      exclusive: true,
      run: (now) => (deps.venues.execution.size ? syncInFlight(deps, db, now) : Promise.resolve({ idle: true })),
    },
    {
      name: "settle-sweep",
      everyMs: MINUTE,
      exclusive: true,
      run: (now) => settleSweep(db, now),
    },
    {
      name: "prune",
      everyMs: 60 * MINUTE,
      exclusive: true,
      run: (now) => prune(db, now),
    },
  );
  return lanes;
}

/** Every venue a source serves may be shown. A source that names none
    (unknown to this build) is never fed. */
export async function displayAllowed(db: Db, venueIds: readonly string[]) {
  if (!venueIds.length) return false;
  const rows = await db
    .select({ id: t.venues.id })
    .from(t.venues)
    .where(and(inArray(t.venues.id, [...venueIds]), eq(t.venues.displayAllowed, true)));
  return rows.length === new Set(venueIds).size;
}

/** Final results with no settlement yet — belt and braces for the event. */
export async function settleSweep(db: Db, now: Date) {
  const due = await db
    .select({ id: t.markets.id })
    .from(t.markets)
    .where(
      and(
        sql`(${t.markets.resolution}->>'final')::boolean`,
        sql`not exists (select 1 from settlements s where s.market_id = ${t.markets.id})`,
      ),
    )
    .limit(50);
  for (const { id } of due) await settleMarket(db, id, now);
  return { settled: due.length };
}

async function prune(db: Db, now: Date) {
  const day = 86_400_000;
  const ago = (ms: number) => new Date(now.getTime() - ms);
  await db.delete(t.jobs).where(and(eq(t.jobs.status, "done"), lt(t.jobs.finishedAt, ago(7 * day))));
  await db.delete(t.outbox).where(and(isNotNull(t.outbox.processedAt), lt(t.outbox.processedAt, ago(7 * day))));
  await db.delete(t.idempotencyKeys).where(lt(t.idempotencyKeys.createdAt, ago(day)));
  await db.delete(t.marketInterest).where(lt(t.marketInterest.until, now));
  await db.delete(t.cacheEntries).where(lt(t.cacheEntries.expiresAt, now));
  await db.delete(t.rateBuckets).where(lt(t.rateBuckets.updatedAt, ago(day)));
  return { pruned: true };
}

const intervalFor = (lane: Lane, intervals: Record<string, number> = {}) =>
  intervals[lane.name] ??
  Object.entries(intervals).find(([prefix]) => lane.name.startsWith(`${prefix}:`))?.[1] ??
  lane.everyMs;

export function createWorker(deps: WorkerDeps, options: WorkerOptions) {
  const lanes = workerLanes(deps);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();
  /** Lease renewals of lanes in flight, stopped with the worker. */
  const beats = new Set<ReturnType<typeof setInterval>>();
  let stopped = true;

  /** Run a lane once (holding its lease if exclusive). */
  async function runLane(lane: Lane) {
    const { db, clock, log } = deps;
    const every = intervalFor(lane, options.intervals);
    const ttl = Math.max(every * 3, 30_000);
    let leased = true;
    try {
      if (lane.exclusive) leased = await takeLease(db, lane.name, options.holder, ttl, clock.now());
    } catch (error) {
      // The database unreachable for a moment (DNS, a dropped connection): try again next tick.
      log.warn("lease unavailable", { lane: lane.name, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      return { failed: true };
    }
    if (!leased) return { skipped: true };
    // Long runs (a full catalog) keep renewing their lease.
    const heartbeat = lane.exclusive
      ? setInterval(() => {
          if (!stopped) void takeLease(db, lane.name, options.holder, ttl, clock.now()).catch(() => {});
        }, ttl / 3)
      : undefined;
    if (heartbeat) beats.add(heartbeat);
    const started = Date.now();
    try {
      const result = await lane.run(clock.now());
      const ms = Date.now() - started;
      if (ms > 1_000 || every >= MINUTE) log.info("lane ran", { lane: lane.name, ms, result });
      return result;
    } catch (error) {
      // A query's own reason (Postgres's code and message) sits in its cause.
      const cause = (error as { cause?: { message?: string; code?: string } }).cause;
      log.error("lane failed", {
        lane: lane.name,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        cause: cause?.message,
        code: cause?.code,
        stack: error instanceof Error ? error.stack : undefined,
      });
      deps.errors.capture(error, { tags: { lane: lane.name } });
      return { failed: true };
    } finally {
      clearInterval(heartbeat);
      if (heartbeat) beats.delete(heartbeat);
    }
  }

  function schedule(lane: Lane, delay: number) {
    if (stopped) return;
    timers.set(
      lane.name,
      setTimeout(() => {
        const run = runLane(lane).then(() => {
          running.delete(lane.name);
          const every = intervalFor(lane, options.intervals);
          // ±10% jitter so replicas and lanes don't march in step.
          schedule(lane, every * (0.9 + Math.random() * 0.2));
        });
        running.set(lane.name, run.then(() => {}));
      }, delay),
    );
  }

  return {
    lanes,
    runLane,
    /** Run one lane by name, now. */
    async run(name: string) {
      const lane = lanes.find((l) => l.name === name);
      if (!lane) throw new Error(`No lane ${name}`);
      return runLane(lane);
    },
    start() {
      stopped = false;
      // Stagger the first runs over a second.
      for (const [i, lane] of lanes.entries()) schedule(lane, (i * 1_000) / lanes.length);
      deps.log.info("worker started", { holder: options.holder, lanes: lanes.map((l) => l.name) });
    },
    async stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      for (const beat of beats) clearInterval(beat);
      // Lanes in flight get a while to finish (a full catalog pass can take
      // longer); the leases go back either way, so a replacement never waits
      // out a lease this process can no longer renew.
      await Promise.race([
        Promise.all(running.values()),
        new Promise((resolve) => setTimeout(resolve, options.stopGraceMs ?? 20_000)),
      ]);
      for (const lane of lanes)
        if (lane.exclusive) await releaseLease(deps.db, lane.name, options.holder).catch(() => {});
    },
  };
}
