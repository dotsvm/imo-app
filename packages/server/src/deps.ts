/**
 * The server's dependencies, built once per process from the composition
 * root. Kept on globalThis so development hot reloads reuse one database pool
 * instead of leaking a new one on every edit.
 */
import { createDeps, type Deps } from "./composition";
export { DEV_SESSION_COOKIE } from "./composition";
import { bootstrap } from "./bootstrap";
import type { Db } from "./db/client";

export type ServerDeps = Deps & { db: Db };

const store = globalThis as unknown as {
  __hunchDeps?: ServerDeps;
  __hunchReady?: Promise<void>;
  __hunchFactory?: typeof createDeps;
};

export function getServerDeps(): ServerDeps {
  // A hot reload of the composition root brings a new factory: rebuild, and
  // close the old pool rather than leak it.
  if (store.__hunchDeps && store.__hunchFactory !== createDeps) {
    // The old instance came from older code: it may predate `close`.
    const old = store.__hunchDeps as Partial<ServerDeps>;
    store.__hunchDeps = undefined;
    store.__hunchReady = undefined;
    void Promise.resolve(old.close?.() ?? old.database?.close()).catch(() => {});
  }
  if (!store.__hunchDeps) {
    store.__hunchFactory = createDeps;
    const deps = createDeps({ application: "hunch-web" });
    if (!deps.database)
      throw new Error(
        "DATABASE_URL is not set: the API needs Postgres (see .env.example).",
      );
    store.__hunchDeps = { ...deps, db: deps.database.db };
  }
  return store.__hunchDeps;
}

/** Registry rows exist before the first request is served. */
export function ready(): Promise<void> {
  store.__hunchReady ??= (async () => {
    const deps = getServerDeps();
    await bootstrap(deps.db, {
      withFixture: deps.profile !== "production" && deps.profile !== "staging",
    });
  })().catch((error) => {
    store.__hunchReady = undefined; // retry on the next request
    throw error;
  });
  return store.__hunchReady;
}
