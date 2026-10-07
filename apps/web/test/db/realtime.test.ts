import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "@imo/server/adapters/memory/runtime";
import { PgRealtime } from "@imo/server/adapters/postgres/realtime";
import type { RealtimeMessage } from "@imo/core/ports/platform";
import { TEST_DATABASE_URL, testDatabase } from "./helpers";

testDatabase().close(); // refuses anything but the test database
const warnings: string[] = [];
const log = createLogger((line) => void warnings.push(line.message));
const publisher = new PgRealtime(TEST_DATABASE_URL, log);
const listener = new PgRealtime(TEST_DATABASE_URL, log);
after(() => Promise.all([publisher.close(), listener.close()]));

const next = (channels: `market:${string}`[]) =>
  new Promise<RealtimeMessage>((resolve) => {
    const stop = listener.subscribe(channels, (message) => {
      stop();
      resolve(message);
    });
  });

test("a NOTIFY from one process reaches another's listeners, by channel", async () => {
  const received = next(["market:fed-dec"]);
  await listener.listening();
  await publisher.publish("market:cpi-oct", "quote", { yesPriceCents: 41 });
  await publisher.publish("market:fed-dec", "quote", { yesPriceCents: 63 });
  assert.deepEqual(await received, {
    channel: "market:fed-dec",
    event: "quote",
    payload: { yesPriceCents: 63 },
  });
});

test("a payload too big for NOTIFY arrives as a prompt to refetch", async () => {
  const received = next(["market:btc"]);
  await listener.listening();
  await publisher.publish("market:btc", "book", { levels: "x".repeat(10_000) });
  assert.deepEqual((await received).payload, { truncated: true });
  assert.ok(warnings.includes("realtime payload truncated"));
});
