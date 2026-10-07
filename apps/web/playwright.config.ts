import { defineConfig } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3100";

/**
 * The end-to-end suite runs against the whole stack — a production build, the
 * worker and a freshly seeded Postgres (packages/server/scripts/e2e-stack.ts).
 *
 * - design: reads only, as the seeded viewer (Jordan), and checks the design
 *   world renders as drawn. Runs first, on untouched data.
 * - flows: everything that writes, as fresh paper traders (and, last, the
 *   seeded viewer's claim). Runs after design.
 */
export default defineConfig({
  testDir: "./e2e",
  // A run empties its output folder first: stacks side by side keep their own.
  outputDir: process.env.E2E_PORT ? `.e2e/results-${PORT}` : "test-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Installed Chrome locally; Playwright's Chromium in CI.
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "design", testMatch: "design/**/*.spec.ts" },
    { name: "flows", testMatch: "flows/**/*.spec.ts", dependencies: ["design"] },
  ],
  // E2E_REUSE=1 runs against a stack you started yourself
  // (packages/server/scripts/e2e-stack.ts) and never starts one: a missing server fails the
  // run instead of resetting a database and rebuilding under running servers.
  webServer: process.env.E2E_REUSE
    ? undefined
    : {
        command: "npx tsx ../../packages/server/scripts/e2e-stack.ts",
        url: `http://localhost:${PORT}/api/v1/config`,
        // Reset, migrate, seed and build before the first request answers.
        timeout: 420_000,
        stdout: "pipe",
        stderr: "pipe",
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
});
