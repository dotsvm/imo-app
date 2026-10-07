/**
 * Leases: one replica runs an exclusive lane at a time. Taking a lapsed lease
 * or renewing your own is one statement, so no session or advisory lock is
 * held — it works through a transaction pooler, and a replica that dies simply
 * stops renewing.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

export async function takeLease(
  db: Db,
  lane: string,
  holder: string,
  ttlMs: number,
  now: Date,
): Promise<boolean> {
  const until = new Date(now.getTime() + ttlMs).toISOString();
  const rows = await db.execute(sql`
    insert into worker_leases (lane, holder, until) values (${lane}, ${holder}, ${until}::timestamptz)
    on conflict (lane) do update set holder = excluded.holder, until = excluded.until, updated_at = now()
    where worker_leases.until < ${now.toISOString()}::timestamptz or worker_leases.holder = excluded.holder
    returning holder`);
  return rows.length > 0;
}

export async function releaseLease(db: Db, lane: string, holder: string) {
  await db.execute(
    sql`delete from worker_leases where lane = ${lane} and holder = ${holder}`,
  );
}
