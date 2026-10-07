import { test } from "node:test";
import assert from "node:assert/strict";
import { ManualClock, createLogger } from "../src/adapters/memory/runtime";
import { SentryReporter, parseDsn } from "../src/adapters/observability/sentry";
import { PostHogAnalytics } from "../src/adapters/observability/posthog";
import type { HttpClient, HttpRequest } from "@imo/core/ports/runtime";

function recorder() {
  const calls: { url: string; request: HttpRequest }[] = [];
  const http: HttpClient = {
    async json(url, request = {}) {
      calls.push({ url, request });
      return null;
    },
  };
  return { http, calls };
}
const log = createLogger(() => {});

test("a DSN names the envelope endpoint and the key", () => {
  assert.deepEqual(parseDsn("https://abc123@o42.ingest.sentry.io/4507"), {
    key: "abc123",
    host: "o42.ingest.sentry.io",
    projectId: "4507",
    endpoint: "https://o42.ingest.sentry.io/api/4507/envelope/",
  });
  assert.throws(() => parseDsn("https://sentry.io/"));
});

test("errors go out as envelopes, once a minute per error, tagged with the request", async () => {
  const clock = new ManualClock();
  const { http, calls } = recorder();
  const sentry = new SentryReporter(http, "https://abc123@o42.ingest.sentry.io/4507", clock, log, { environment: "production" });
  sentry.capture(new Error("pool exhausted"), { requestId: "req-1", userId: "u-1", tags: { path: "/api/v1/orders" } });
  sentry.capture(new Error("pool exhausted"), { requestId: "req-2" });
  await sentry.flush();
  assert.equal(calls.length, 1, "a flood is one report");
  const [header, item, payload] = calls[0].request.rawBody!.text.split("\n").map((line) => JSON.parse(line));
  assert.equal(calls[0].request.rawBody!.contentType, "application/x-sentry-envelope");
  assert.match(calls[0].request.headers!["x-sentry-auth"], /sentry_key=abc123/);
  assert.equal(item.type, "event");
  assert.equal(header.event_id, payload.event_id);
  assert.equal(payload.exception.values[0].value, "pool exhausted");
  assert.deepEqual(payload.tags, { path: "/api/v1/orders", request_id: "req-1" });
  assert.deepEqual(payload.user, { id: "u-1" });
  clock.advance(61_000);
  sentry.capture(new Error("pool exhausted"));
  await sentry.flush();
  assert.equal(calls.length, 2, "and again after a minute");
});

test("analytics batch up and go in one request", async () => {
  const clock = new ManualClock();
  const { http, calls } = recorder();
  const posthog = new PostHogAnalytics(http, "phc_key", "https://us.i.posthog.com/", clock, log, 60_000);
  posthog.capture("order_filled", "u-1", { market: "fed-dec" });
  posthog.capture("followed", "u-2");
  assert.equal(calls.length, 0, "nothing sent per event");
  await posthog.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://us.i.posthog.com/batch/");
  const body = calls[0].request.body as { api_key: string; batch: { event: string; distinct_id: string }[] };
  assert.equal(body.api_key, "phc_key");
  assert.deepEqual(body.batch.map((e) => [e.event, e.distinct_id]), [["order_filled", "u-1"], ["followed", "u-2"]]);
  await posthog.flush();
  assert.equal(calls.length, 1, "an empty queue sends nothing");
});
