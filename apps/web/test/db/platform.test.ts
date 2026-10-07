import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import {
  defineCacheConformance,
  defineJobQueueConformance,
  defineRateLimiterConformance,
} from "@imo/server/adapters/conformance";
import { PgCache } from "@imo/server/adapters/postgres/cache";
import { PgRateLimiter } from "@imo/server/adapters/postgres/rate-limiter";
import { ManualClock } from "@imo/server/adapters/memory/runtime";
import { PgJobQueue } from "@imo/server/adapters/postgres/jobs";
import * as t from "@imo/server/db/schema";
import { appendEvent, relayOutbox } from "@imo/server/outbox";
import { dbError, resetDatabase, testDatabase } from "./helpers";

const database = testDatabase();
const { db } = database;
before(() => resetDatabase(db));
after(() => database.close());

defineJobQueueConformance(
  "postgres",
  async (clock) => {
    await db.delete(t.jobs);
    return new PgJobQueue(db, clock);
  },
  () => new ManualClock(),
);

async function seedAccount() {
  const [user] = await db
    .insert(t.users)
    .values({
      handle: `u${Math.random().toString(36).slice(2, 8)}`,
      displayName: "Test",
      initials: "TE",
    })
    .returning();
  await db
    .insert(t.executionRoutes)
    .values({
      id: "paper",
      mode: "paper",
      fee: { kind: "none" },
      enabled: true,
    })
    .onConflictDoNothing();
  const [account] = await db
    .insert(t.tradingAccounts)
    .values({
      userId: user.id,
      routeId: "paper",
      currency: "USD",
      cash: 10_000_000_000,
      startingBalance: 10_000_000_000,
    })
    .returning();
  return account;
}

test("the ledger is append-only", async () => {
  const account = await seedAccount();
  const [entry] = await db
    .insert(t.ledgerEntries)
    .values({
      accountId: account.id,
      amount: 10_000_000_000,
      currency: "USD",
      kind: "deposit",
    })
    .returning();
  await assert.rejects(
    db
      .update(t.ledgerEntries)
      .set({ amount: 1 })
      .where(eq(t.ledgerEntries.id, entry.id)),
    dbError(/append-only/),
  );
  await assert.rejects(
    db.delete(t.ledgerEntries).where(eq(t.ledgerEntries.id, entry.id)),
    dbError(/append-only/),
  );
});

test("balances can't go negative, and reserves can't exceed cash", async () => {
  const account = await seedAccount();
  await assert.rejects(
    db
      .update(t.tradingAccounts)
      .set({ cash: -1 })
      .where(eq(t.tradingAccounts.id, account.id)),
    dbError(/trading_accounts_cash/),
  );
  await assert.rejects(
    db
      .update(t.tradingAccounts)
      .set({ reserved: account.cash + 1 })
      .where(eq(t.tradingAccounts.id, account.id)),
    dbError(/trading_accounts_cash/),
  );
});

beforeEach(async () => {
  await db.delete(t.outbox);
});

test("the outbox relays committed events in order, and keeps failures for retry", async () => {
  await db.transaction(async (tx) => {
    await appendEvent(tx, "order.filled", "order:1", { n: 1 });
    await appendEvent(tx, "order.filled", "order:2", { n: 2 });
  });
  // A rolled-back transaction leaves no event behind.
  await assert.rejects(
    db.transaction(async (tx) => {
      await appendEvent(tx, "order.filled", "order:ghost", { n: 99 });
      throw new Error("rollback");
    }),
  );
  const seen: number[] = [];
  let fail = true;
  const handlers = new Map([
    [
      "order.filled",
      [
        async (e: { payload: unknown }) => {
          const n = (e.payload as { n: number }).n;
          if (n === 2 && fail) throw new Error("flaky handler");
          seen.push(n);
        },
      ],
    ],
  ]);
  const first = await relayOutbox(db, handlers);
  assert.deepEqual([first.relayed, seen], [1, [1]]);
  fail = false;
  const second = await relayOutbox(db, handlers);
  assert.deepEqual([second.relayed, seen], [1, [1, 2]]);
  assert.equal((await relayOutbox(db, handlers)).seen, 0, "nothing left");
  const [row] = await db
    .select()
    .from(t.outbox)
    .where(eq(t.outbox.subject, "order:2"));
  assert.equal(row.attempts, 1);
  assert.match(row.lastError ?? "", /flaky/);
});

test("every table has row level security, so client roles can read nothing", async () => {
  const rows = await db.execute<{ table: string }>(sql`
    select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '__drizzle_migrations'
      and not c.relrowsecurity`);
  assert.deepEqual(rows.map((r) => r.table), []);
});

const shared = new ManualClock();
defineCacheConformance("postgres", (clock) => new PgCache(db, clock), () => shared);
defineRateLimiterConformance(
  "postgres token buckets",
  (clock) => new PgRateLimiter(db, { "venue:read": { perSecond: 10, capacity: 30 } }, clock),
  () => shared,
);

test("postgres buckets are shared: two limiters on one table spend one budget", async () => {
  const clock = new ManualClock("2026-09-25T10:00:00Z");
  const budgets = { "api:write": { perSecond: 1, capacity: 3 } };
  const a = new PgRateLimiter(db, budgets, clock);
  const b = new PgRateLimiter(db, budgets, clock);
  assert.ok(await a.tryAcquire("api:write:someone", 2));
  assert.ok(await b.tryAcquire("api:write:someone", 1));
  assert.equal(await a.tryAcquire("api:write:someone", 1), false, "the other instance spent the rest");
  clock.advance(1_000);
  assert.ok(await b.tryAcquire("api:write:someone", 1));
});
