import { sql } from "drizzle-orm";
import { createDatabase, type Db } from "@imo/server/db/client";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/hunch_test";

/** A connection to the test database. Refuses anything that isn't a test
    database, so a stray env var can never truncate real data. */
export function testDatabase() {
  if (!/\/hunch_test(\?|$)/.test(TEST_DATABASE_URL))
    throw new Error(`Refusing to run DB tests against ${TEST_DATABASE_URL}`);
  return createDatabase(TEST_DATABASE_URL, { max: 4, application: "tests" });
}

/** Empty every table (migrations excepted). */
export async function resetDatabase(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${list} restart identity cascade`));
}

/** Drizzle wraps database errors; the Postgres message is on `cause`. */
export const dbError = (pattern: RegExp) => (error: unknown) => {
  const e = error as { message?: string; cause?: { message?: string } };
  return pattern.test(`${e.cause?.message ?? ""} ${e.message ?? ""}`);
};
