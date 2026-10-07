/**
 * The end-to-end stack, started by Playwright (`npm run test:e2e`): a fresh
 * database with the design world seeded, the worker, the web app as a
 * production build on port 3100 and the waitlist app (apps/waitlist) beside
 * it on 3101 — the same pieces a deployment runs.
 *
 *   npx tsx packages/server/scripts/e2e-stack.ts        # keep one up, then E2E_REUSE=1 npm run test:e2e
 *
 * E2E_SKIP_BUILD=1 reuses the last build; E2E_PORT and E2E_DATABASE_URL
 * (hunch_e2e_<name>) run more than one side by side. Refuses other databases.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, openSync } from "node:fs";
import postgres from "postgres";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/hunch_e2e";
const PORT = process.env.E2E_PORT ?? "3100";
const WAITLIST_PORT = String(Number(PORT) + 1);
// hunch_e2e, or hunch_e2e_<name> for stacks side by side (one per port).
if (!/\/hunch_e2e(_[a-z0-9]+)?(\?|$)/.test(DATABASE_URL))
  throw new Error(`Refusing to reset ${DATABASE_URL}: not an e2e database.`);

/**
 * Every provider the app can reach: set empty, never inherited. Next (and our
 * scripts) fill in from .env.local any variable the process leaves unset — so
 * without this, your real Supabase, Privy and Resend keys would run the
 * suite. Empty is set, and the config reads it as "not configured".
 */
const PROVIDERS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "RESEND_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "KALSHI_API_KEY_ID",
  "KALSHI_PRIVATE_KEY",
  "DATA_SOURCES",
  "ADMIN_EMAILS",
];

/** Only what the stack needs: nothing from .env.local or the shell's
    provider keys leaks in. */
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(PROVIDERS.map((key) => [key, ""])),
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: process.env.CI,
  // Postgres credentials (PGUSER, PGPASSWORD… in CI).
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("PG"))),
  APP_PROFILE: "demo",
  DATABASE_URL,
  DIRECT_URL: DATABASE_URL,
  APP_URL: `http://localhost:${PORT}`,
  WAITLIST_URL: `http://localhost:${WAITLIST_PORT}`,
  SESSION_SECRET: "e2e-session-secret-not-for-production-000000",
  // Pinned, so a local setting can't change what the suite asserts.
  PAPER_STARTING_BALANCE: "10000",
  KALSHI_ENV: "demo",
  LOCAL_STORAGE_DIR: `.e2e/uploads-${PORT}`,
  PORT,
  NEXT_TELEMETRY_DISABLED: "1",
  // Tests load pages far faster than people; budgets themselves are unit-tested.
  API_RATE_SCALE: "20",
  // A production build, and everything else as it runs deployed.
  NODE_ENV: "production",
};

/** Every process runs from its own folder in the monorepo. */
const ROOT = join(__dirname, "../../..");
const at = (dir: string) => join(ROOT, dir);

function run(command: string, args: string[], cwd = ROOT) {
  const result = spawnSync(command, args, { env, stdio: "inherit", cwd });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

async function freshDatabase() {
  const url = new URL(DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
}

/** Poll until a URL answers (60 seconds at most). */
async function until(url: string) {
  for (let i = 0; i < 120; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} never answered`);
}

const children: ChildProcess[] = [];
function stop(code = 0) {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function main() {
  console.log(`[e2e] fresh database ${DATABASE_URL}`);
  await freshDatabase();
  run("npx", ["drizzle-kit", "migrate"], at("packages/server"));
  run("npx", ["tsx", "scripts/seed.ts"], at("packages/server"));
  if (!process.env.E2E_SKIP_BUILD) {
    run("npx", ["next", "build"], at("apps/web"));
    run("npx", ["next", "build"], at("apps/waitlist"));
  }

  // Not test-results/: Playwright empties that when a run starts.
  mkdirSync(at(".e2e"), { recursive: true });
  const logPath = at(`.e2e/worker-${PORT}.log`);
  const log = openSync(logPath, "w");
  const worker = spawn("npx", ["tsx", "src/main.ts"], { env, stdio: ["ignore", log, log], cwd: at("apps/worker") });
  children.push(worker);
  worker.on("exit", (code) => {
    console.error(`[e2e] worker exited (${code}); see ${logPath}`);
    stop(1);
  });

  // The waitlist app answers before the web app does, so Playwright (which
  // waits on the web app) never starts with half the stack.
  const waitlist = spawn("npx", ["next", "start", "-p", WAITLIST_PORT], {
    env: { ...env, APP_URL: `http://localhost:${WAITLIST_PORT}`, PORT: WAITLIST_PORT },
    stdio: "inherit",
    cwd: at("apps/waitlist"),
  });
  children.push(waitlist);
  waitlist.on("exit", (code) => stop(code ?? 1));
  await until(`http://localhost:${WAITLIST_PORT}/api/v1/waitlist/config`);

  const web = spawn("npx", ["next", "start", "-p", PORT], { env, stdio: "inherit", cwd: at("apps/web") });
  children.push(web);
  web.on("exit", (code) => stop(code ?? 0));
}

main().catch((error: unknown) => {
  console.error(error);
  stop(1);
});
