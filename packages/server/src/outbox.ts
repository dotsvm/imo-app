/**
 * The transactional outbox. A use case writes its change and the event that
 * describes it in one transaction; the worker relays events afterwards to
 * whoever listens — realtime, notifications, email, analytics. Nothing is ever
 * published for a change that rolled back, and nothing committed is lost.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { DomainEvent } from "@imo/core/ports/platform";
import type { Db, Queryable } from "./db/client";
import { outbox } from "./db/schema";

export async function appendEvent(
  q: Queryable,
  type: string,
  subject: string,
  payload: Record<string, unknown>,
) {
  await q.insert(outbox).values({ type, subject, payload });
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * Relay pending events in order. Each event is handled by every handler for
 * its type; a failure leaves the event pending (with the error) for the next
 * pass, so handlers must tolerate seeing an event twice.
 */
export async function relayOutbox(
  db: Db,
  handlers: ReadonlyMap<string, EventHandler[]>,
  batch = 100,
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(sql`${outbox.processedAt} is null and ${outbox.attempts} < 10`)
      .orderBy(asc(outbox.id))
      .limit(batch)
      .for("update", { skipLocked: true });
    let relayed = 0;
    for (const row of rows) {
      const event: DomainEvent = {
        id: String(row.id),
        type: row.type,
        subject: row.subject,
        payload: row.payload,
        at: row.createdAt.toISOString(),
      };
      try {
        for (const handler of handlers.get(row.type) ?? [])
          await handler(event);
        await tx
          .update(outbox)
          .set({ processedAt: new Date() })
          .where(eq(outbox.id, row.id));
        relayed++;
      } catch (error) {
        await tx
          .update(outbox)
          .set({
            attempts: row.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error),
          })
          .where(eq(outbox.id, row.id));
      }
    }
    return { relayed, seen: rows.length };
  });
}
