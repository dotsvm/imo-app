/**
 * Local env files live once, at the repository root, for every app and
 * script (the web app, the worker, the waitlist, maintenance scripts).
 * Deployed, the host sets the variables and there are no files to read.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvConfig } from "@next/env";

/** The nearest folder above `from` that holds the workspace lockfile. */
export function repoRoot(from = process.cwd()) {
  let dir = from;
  while (!existsSync(join(dir, "package-lock.json")) || !existsSync(join(dir, "packages"))) {
    const up = dirname(dir);
    if (up === dir) return from;
    dir = up;
  }
  return dir;
}

export function loadRepoEnv() {
  loadEnvConfig(repoRoot());
}
