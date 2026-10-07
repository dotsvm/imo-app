/**
 * Give someone the admin role (and beta access), by handle.
 *   npx tsx packages/server/scripts/make-admin.ts <handle>
 * Uses DATABASE_URL (from .env.local locally). Writes an audit line.
 */
import { loadRepoEnv } from "../src/env";
import { sql } from "drizzle-orm";
import { createDeps } from "../src/composition";
import * as t from "../src/db/schema";

loadRepoEnv();

async function main() {
  const handle = process.argv[2]?.replace(/^@/, "");
  if (!handle) throw new Error("Usage: npx tsx packages/server/scripts/make-admin.ts <handle>");
  const deps = createDeps({ application: "hunch-admin-script" });
  if (!deps.database) throw new Error("DATABASE_URL is not set.");
  const { db } = deps.database;
  const [user] = await db
    .update(t.users)
    .set({ role: "admin", accessGrantedAt: sql`coalesce(${t.users.accessGrantedAt}, now())` })
    .where(sql`lower(${t.users.handle}) = lower(${handle})`)
    .returning({ id: t.users.id, handle: t.users.handle });
  if (!user) throw new Error(`No one with the handle ${handle}.`);
  await db.insert(t.auditLog).values({ actorId: null, action: "person.update", subject: `user:${user.id}`, data: { role: "admin", via: "script" } });
  console.log(`@${user.handle} is now an admin.`);
  await deps.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
