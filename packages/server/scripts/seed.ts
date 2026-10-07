/**
 * Seed a database with the design dataset, for the demo profile and tests.
 *   npx tsx packages/server/scripts/seed.ts            # DATABASE_URL from .env.local
 *   DATABASE_URL=… npx tsx packages/server/scripts/seed.ts
 * Refuses to run against a production or staging profile.
 */
import { loadRepoEnv } from "../src/env";
import { createDeps } from "../src/composition";
import { bootstrap } from "../src/bootstrap";
import { seedDesign } from "../src/demo/seed";

loadRepoEnv();

async function main() {
  const deps = createDeps({ application: "hunch-seed" });
  if (deps.profile === "production" || deps.profile === "staging")
    throw new Error(`Refusing to seed a ${deps.profile} database.`);
  if (!deps.database) throw new Error("DATABASE_URL is not set.");
  const { db } = deps.database;
  await bootstrap(db, { withFixture: true });
  const summary = await seedDesign(db, deps.log);
  console.log(JSON.stringify(summary, null, 1));
  await deps.database.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
