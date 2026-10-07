/**
 * Provider conformance kits: the behavior every adapter of a port must show.
 * The in-memory twin runs them in every test run; a production adapter runs
 * them against its real service (CI service containers) before it ships.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cache, JobQueue, Mailer } from "@imo/core/ports/platform";
import type { RateLimiter } from "@imo/core/ports/runtime";
import type { ManualClock } from "./memory/runtime";

type MaybePromise<T> = T | Promise<T>;

export function defineCacheConformance(
  name: string,
  create: (clock: ManualClock) => Cache,
  clock: () => ManualClock,
) {
  describe(`cache conformance · ${name}`, () => {
    it("stores copies, not references, and expires on time", async () => {
      const c = clock();
      const cache = create(c);
      const value = { price: 62, tags: ["a"] };
      await cache.set("k", value, 10);
      value.tags.push("mutated");
      assert.deepEqual(await cache.get("k"), { price: 62, tags: ["a"] });
      c.advance(9_999);
      assert.ok(await cache.get("k"));
      c.advance(1);
      assert.equal(await cache.get("k"), undefined);
    });
    it("deletes, and rejects nonsense TTLs", async () => {
      const cache = create(clock());
      await cache.set("k", 1, 60);
      await cache.delete("k");
      assert.equal(await cache.get("k"), undefined);
      await assert.rejects(cache.set("k", 1, 0));
    });
  });
}

export function defineJobQueueConformance(
  name: string,
  create: (clock: ManualClock) => MaybePromise<
    JobQueue & {
      drain(): Promise<{ ran: number; waiting: number }>;
      dead: unknown[];
    }
  >,
  clock: () => ManualClock,
) {
  describe(`job queue conformance · ${name}`, () => {
    it("runs jobs with their payloads, and drops duplicate keys while pending", async () => {
      const queue = await create(clock());
      const seen: unknown[] = [];
      queue.work<{ n: number }>(
        "settle",
        async (job) => void seen.push(job.payload.n),
      );
      assert.ok(await queue.enqueue("settle", { n: 1 }, { key: "market:1" }));
      assert.equal(
        await queue.enqueue("settle", { n: 2 }, { key: "market:1" }),
        null,
      );
      await queue.drain();
      assert.deepEqual(seen, [1]);
      assert.ok(
        await queue.enqueue("settle", { n: 3 }, { key: "market:1" }),
        "key frees once done",
      );
    });
    it("waits for runAt, retries with backoff, and dead-letters after its attempts", async () => {
      const c = clock();
      const queue = await create(c);
      let calls = 0;
      queue.work("flaky", async () => {
        calls++;
        throw new Error("boom");
      });
      await queue.enqueue(
        "flaky",
        {},
        { attempts: 3, runAt: new Date(c.now().getTime() + 5_000) },
      );
      await queue.drain();
      assert.equal(calls, 0, "ran before runAt");
      for (let i = 0; i < 10; i++) {
        c.advance(60_000);
        await queue.drain();
      }
      assert.equal(calls, 3);
      assert.equal(queue.dead.length, 1);
    });
  });
}

export function defineRateLimiterConformance(
  name: string,
  create: (clock: ManualClock) => RateLimiter,
  clock: () => ManualClock,
) {
  describe(`rate limiter conformance · ${name}`, () => {
    it("allows the burst, refuses beyond it, and refills over time", async () => {
      const c = clock();
      const limiter = create(c);
      // The kit's budget: 10 tokens per second, capacity 30.
      assert.ok(await limiter.tryAcquire("venue:read", 30));
      assert.equal(await limiter.tryAcquire("venue:read", 10), false);
      c.advance(1_000);
      assert.ok(await limiter.tryAcquire("venue:read", 10));
      assert.equal(await limiter.tryAcquire("venue:read", 1), false);
    });
    it("refuses unknown budgets instead of allowing everything", async () => {
      await assert.rejects(create(clock()).tryAcquire("nobody:configured"));
    });
  });
}

export function defineMailerConformance(
  name: string,
  create: () => Mailer & { sent: unknown[] },
) {
  describe(`mailer conformance · ${name}`, () => {
    it("delivers once per idempotency key", async () => {
      const mailer = create();
      const message = {
        template: "order-filled",
        to: "a@example.com",
        data: {},
        idempotencyKey: "order-1",
      };
      await mailer.send(message);
      await mailer.send(message);
      assert.equal(mailer.sent.length, 1);
    });
  });
}
