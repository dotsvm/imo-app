import { after, before, describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  defineCacheConformance,
  defineJobQueueConformance,
  defineMailerConformance,
  defineRateLimiterConformance,
} from "../src/adapters/conformance";
import {
  MemoryCache,
  MemoryJobQueue,
  MemoryMailer,
} from "../src/adapters/memory/platform";
import {
  createLogger,
  ManualClock,
  TokenBucketLimiter,
} from "../src/adapters/memory/runtime";
import {
  CircuitOpen,
  createFetchClient,
  EgressDenied,
} from "../src/adapters/http/fetch-client";
import { HttpError } from "@imo/core/ports/runtime";
import { createDeps } from "../src/composition";

const clock = () => new ManualClock();
defineCacheConformance("memory", (c) => new MemoryCache(c), clock);
defineJobQueueConformance("memory", (c) => new MemoryJobQueue(c), clock);
defineRateLimiterConformance(
  "token bucket",
  (c) =>
    new TokenBucketLimiter(
      { "venue:read": { perSecond: 10, capacity: 30 } },
      c,
    ),
  clock,
);
defineMailerConformance("memory", () => new MemoryMailer());

// -------------------------------------------------------------- http client
describe("fetch client", () => {
  let server: Server;
  let base = "";
  const hits = new Map<string, number>();
  // Each path scripts a sequence of responses: [status, body, headers?].
  const script = new Map<
    string,
    [number, unknown, Record<string, string>?][]
  >();

  before(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      hits.set(path, (hits.get(path) ?? 0) + 1);
      if (path === "/slow") return void setTimeout(() => res.end("{}"), 300);
      const steps = script.get(path) ?? [[200, { ok: true }]];
      const [status, body, headers] =
        steps.length > 1 ? steps.shift()! : steps[0];
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  after(() => server.close());

  const make = (
    c = new ManualClock(),
    extra: Partial<Parameters<typeof createFetchClient>[0]> = {},
  ) => {
    const slept: number[] = [];
    const client = createFetchClient({
      allow: ["127.0.0.1"],
      log: createLogger(() => {}),
      clock: c,
      sleep: async (ms) => void slept.push(ms),
      random: () => 0.5,
      ...extra,
    });
    return { client, slept, c };
  };

  it("returns parsed JSON", async () => {
    const { client } = make();
    assert.deepEqual(await client.json(`${base}/ok`), { ok: true });
  });

  it("retries transient failures on idempotent calls, honoring Retry-After", async () => {
    script.set("/flaky", [
      [503, {}],
      [429, {}, { "retry-after": "2" }],
      [200, { v: 1 }],
    ]);
    const { client, slept } = make();
    assert.deepEqual(await client.json(`${base}/flaky`), { v: 1 });
    assert.equal(hits.get("/flaky"), 3);
    assert.equal(slept[1], 2_000, "Retry-After wins over the backoff");
  });

  it("never retries a definite answer, or a non-idempotent write", async () => {
    script.set("/missing", [[404, { error: "no" }]]);
    const { client } = make();
    await assert.rejects(
      client.json(`${base}/missing`),
      (e: HttpError) => e.status === 404,
    );
    assert.equal(hits.get("/missing"), 1);
    script.set("/write", [[500, {}]]);
    await assert.rejects(
      client.json(`${base}/write`, { method: "POST", body: { a: 1 } }),
    );
    assert.equal(hits.get("/write"), 1);
  });

  it("refuses hosts that aren't allowlisted before any request", async () => {
    const { client } = make();
    await assert.rejects(
      client.json("https://evil.example.com/x"),
      EgressDenied,
    );
    await assert.rejects(client.json("http://api.example.com/x"), EgressDenied);
  });

  it("times out slow responses", async () => {
    const { client } = make(new ManualClock(), { timeoutMs: 50, attempts: 1 });
    await assert.rejects(
      client.json(`${base}/slow`),
      (e: Error) => e.name === "TimeoutError",
    );
  });

  it("opens the circuit after repeated failures, then probes after the cooldown", async () => {
    script.set("/down", [[503, {}]]);
    const c = new ManualClock();
    const { client } = make(c, {
      attempts: 1,
      breakAfter: 3,
      cooldownMs: 10_000,
    });
    for (let i = 0; i < 3; i++)
      await assert.rejects(client.json(`${base}/down`));
    const before = hits.get("/down");
    await assert.rejects(client.json(`${base}/down`), CircuitOpen);
    assert.equal(
      hits.get("/down"),
      before,
      "an open circuit doesn't touch the host",
    );
    c.advance(10_001);
    script.set("/down", [[200, { back: true }]]);
    assert.deepEqual(await client.json(`${base}/down`), { back: true });
    assert.deepEqual(
      await client.json(`${base}/down`),
      { back: true },
      "closed again",
    );
  });
});

// ------------------------------------------------------------- composition
test("the test profile wires in-memory adapters and the fixture venue", async () => {
  const deps = createDeps({ env: { APP_PROFILE: "test" } });
  assert.equal(deps.unprovisioned.length, 0);
  assert.ok(deps.venues.sources.has("fixture"));
  assert.ok(deps.venues.manifests.some((m) => m.id === "fixture"));
  assert.deepEqual(deps.venues.feeds, ["fixture"]);
  const page = await deps.venues.sources.get("fixture")!.listMarkets();
  assert.ok(page.items.length > 0);
  await deps.cache.set("x", 1, 60);
  assert.equal(await deps.cache.get("x"), 1);
});

test("production never falls back to memory: unprovisioned ports fail loudly", () => {
  const deps = createDeps({
    env: { APP_PROFILE: "production" },
    logSink: () => {},
  });
  assert.deepEqual([...deps.unprovisioned].sort(), [
    "cache",
    "database",
    "events",
    "flags",
    "identity",
    "jobs",
    "mailer",
    "realtime",
    "storage",
  ]);
  assert.throws(() => deps.cache.get("x"), /cache is not provisioned/);
  assert.deepEqual(
    [...deps.venues.sources.keys()].sort(),
    ["jupiter-predict", "kalshi-direct", "polymarket-public"],
    "live venues only: no fixture, no demo dataset",
  );
  assert.deepEqual(deps.venues.feeds, ["kalshi-direct", "polymarket-public", "jupiter-predict"]);
  assert.ok(!deps.venues.manifests.some((m) => m.id === "fixture"));
});

test("the demo runs the design dataset without a feed, and live sources when asked", () => {
  const quiet = { logSink: () => {} };
  const demo = createDeps({ env: { APP_PROFILE: "demo" }, ...quiet });
  assert.ok(demo.venues.sources.has("demo-design"));
  assert.deepEqual(demo.venues.feeds, [], "seeded, not fed; the fixture stays out of the catalog");
  const mixed = createDeps({
    env: { APP_PROFILE: "demo", DATA_SOURCES: "demo-design,kalshi-demo" },
    ...quiet,
  });
  assert.deepEqual(mixed.venues.feeds, ["kalshi-demo"]);
});

test("bad configuration stops boot with the problems listed", () => {
  assert.throws(
    () => createDeps({ env: { APP_PROFILE: "prod", LOG_LEVEL: "loud" } }),
    (e: Error) => /APP_PROFILE/.test(e.message) && /LOG_LEVEL/.test(e.message),
  );
});

test("the API rate scale multiplies people's budgets, never the venues'", async () => {
  const { RATE_BUDGETS, scaleApiBudgets } = await import("../src/composition");
  const scaled = scaleApiBudgets(RATE_BUDGETS, 10);
  assert.equal(scaled["api:read"].capacity, RATE_BUDGETS["api:read"].capacity * 10);
  assert.equal(scaled["api:auth"].perSecond, RATE_BUDGETS["api:auth"].perSecond * 10);
  assert.deepEqual(scaled["kalshi:read"], RATE_BUDGETS["kalshi:read"]);
  assert.equal(scaleApiBudgets(RATE_BUDGETS, 1), RATE_BUDGETS);
});

test("Supabase Realtime only when the database is Supabase's: its policy authorizes private topics", async () => {
  const supabase = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SECRET_KEY: "sb_secret_test",
  };
  const quiet = { logSink: () => {} };
  const local = createDeps({ env: { APP_PROFILE: "demo", DATABASE_URL: "postgres://localhost:5432/hunch_dev", ...supabase }, ...quiet });
  assert.equal(local.realtimeTransport.kind, "sse", "a local database: the API's own stream");
  const hosted = createDeps({
    env: {
      APP_PROFILE: "demo",
      DATABASE_URL: "postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      DIRECT_URL: "postgres://u:p@db.abcd.supabase.co:5432/postgres",
      ...supabase,
    },
    ...quiet,
  });
  assert.equal(hosted.realtimeTransport.kind, "supabase");
  await Promise.all([local.close(), hosted.close()]);
});

test("configured providers' own hosts are allowed out, and only then", async () => {
  const quiet = { logSink: () => {} };
  const withKeys = createDeps({
    env: { APP_PROFILE: "demo", NEXT_PUBLIC_PRIVY_APP_ID: "app", PRIVY_APP_SECRET: "secret", RESEND_API_KEY: "re_test" },
    ...quiet,
  });
  const without = createDeps({ env: { APP_PROFILE: "demo" }, ...quiet });
  const allowed = async (deps: typeof withKeys, url: string) =>
    deps.http.json(url, { timeoutMs: 1 }).then(
      () => true,
      (e: Error) => !/not allowlisted/.test(e.message),
    );
  for (const url of ["https://auth.privy.io/x", "https://api.privy.io/x", "https://api.resend.com/x"]) {
    assert.equal(await allowed(withKeys, url), true, `${url} with keys`);
    assert.equal(await allowed(without, url), false, `${url} without keys`);
  }
  await Promise.all([withKeys.close(), without.close()]);
});

describe("Privy wallets", () => {
  const user = (id: string) => ({
    id,
    linked_accounts: [
      { type: "custom_auth", custom_user_id: "sub-1" },
      { type: "wallet", wallet_client_type: "privy", chain_type: "solana", address: "So1anaAddre55So1anaAddre55So1anaAddre55So1" },
      { type: "wallet", wallet_client_type: "privy", chain_type: "ethereum", address: "0x1111111111111111111111111111111111111111" },
    ],
  });

  it("uses the person another request just made, when Privy refuses a duplicate", async () => {
    const { PrivyWallets } = await import("../src/adapters/wallets/privy");
    const calls: string[] = [];
    let lookups = 0;
    const http = {
      async json(url: string, request?: { method?: string }) {
        calls.push(`${request?.method ?? "GET"} ${new URL(url).pathname}`);
        if (url.endsWith("/custom_auth/id")) {
          lookups += 1;
          // Not there yet on the first look; there on the second.
          if (lookups === 1) throw new HttpError(404, url);
          return { user: user("did:privy:1") };
        }
        if (url.endsWith("/v1/users")) throw new HttpError(422, url, '{"error":"User already exists"}');
        throw new Error(`unexpected ${url}`);
      },
    };
    const wallets = await new PrivyWallets(http, "app", "secret").walletsFor({ provider: "supabase", subject: "sub-1" });
    assert.deepEqual(wallets.map((w) => w.chain).sort(), ["ethereum", "solana"]);
    assert.deepEqual(calls, ["POST /api/v1/users/custom_auth/id", "POST /v1/users", "POST /api/v1/users/custom_auth/id"]);
  });

  it("still fails loudly on a refusal that isn't a duplicate", async () => {
    const { PrivyWallets } = await import("../src/adapters/wallets/privy");
    const http = {
      async json(url: string) {
        if (url.endsWith("/custom_auth/id")) throw new HttpError(404, url);
        throw new HttpError(422, url, '{"error":"Invalid wallet"}');
      },
    };
    await assert.rejects(new PrivyWallets(http, "app", "secret").walletsFor({ provider: "supabase", subject: "sub-2" }), /422/);
  });
});
