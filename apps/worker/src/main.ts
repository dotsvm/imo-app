/**
 * The worker process — everything that runs on a clock: venue feeds, price
 * refreshes, order matching, settlement, the outbox relay, queued jobs.
 *
 *   npm run worker
 *
 * Deploy it as a long-running service beside the web app (Railway, Fly, a
 * VM). Several replicas are fine: exclusive lanes hold leases, the rest share
 * work with SKIP LOCKED.
 */
import { hostname } from "node:os";
import { loadRepoEnv } from "@imo/server/env";
import { createDeps } from "@imo/server/composition";
import { bootstrap } from "@imo/server/bootstrap";
import { DESIGN_SOURCE } from "@imo/server/demo/design-source";
import { seedDesign } from "@imo/server/demo/seed";
import { createWorker } from "@imo/server/worker";

loadRepoEnv();

async function main() {
  const deps = createDeps({ application: "hunch-worker" });
  if (!deps.database)
    throw new Error("DATABASE_URL is not set: the worker needs Postgres.");
  if (deps.unprovisioned.length)
    deps.log.warn("ports not provisioned", { ports: deps.unprovisioned });
  const serverDeps = { ...deps, db: deps.database.db };
  const live = deps.profile === "production" || deps.profile === "staging";
  await bootstrap(serverDeps.db, { withFixture: !live });
  // The design dataset has no feed: it's seeded, once, as-is.
  if (deps.venues.sources.has(DESIGN_SOURCE) && !live)
    await seedDesign(serverDeps.db, deps.log);

  const worker = createWorker(serverDeps, {
    holder: `${hostname()}:${process.pid}`,
  });
  worker.start();

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    deps.log.info("worker stopping", { signal });
    // Finish the lanes in flight, hand leases back, then close pools.
    const deadline = setTimeout(() => process.exit(1), 25_000);
    await worker.stop();
    await deps.close();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  // A socket dropping under a pool (the database or a venue unreachable for a
  // moment) can surface outside any lane; the next tick reconnects. Anything
  // else is a bug: exit, and let the supervisor restart us.
  process.on("unhandledRejection", (error) => {
    const code = (error as { code?: string } | undefined)?.code;
    if (code && NETWORK_ERRORS.has(code)) {
      deps.log.warn("connection dropped", { code, error: (error as Error).message });
      return;
    }
    deps.log.error("unhandled rejection", { error: error instanceof Error ? error.stack : String(error) });
    process.exit(1);
  });
}

const NETWORK_ERRORS = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
