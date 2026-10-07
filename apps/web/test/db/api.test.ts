import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as t from "@imo/server/db/schema";
import { getServerDeps } from "@imo/server/deps";
import { GET as me } from "../../src/app/api/v1/me/route";
import { POST as devSession } from "../../src/app/api/v1/dev/session/route";
import { resetDatabase } from "./helpers";

const noParams = { params: Promise.resolve({}) };
const request = (
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) => new NextRequest(`http://localhost${path}`, init);

async function signIn(subject: string, name = "Test Trader") {
  const res = await devSession(
    request("/api/v1/dev/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${subject.length}`,
      },
      body: JSON.stringify({ subject, name, email: `${subject}@example.com` }),
    }),
    noParams,
  );
  assert.equal(res.status, 200);
  const { token } = (await res.json()) as { token: string };
  return { authorization: `Bearer ${token}` };
}

const deps = () => getServerDeps();
before(async () => resetDatabase(deps().db));
after(async () => deps().database?.close());

test("signed-out requests get a uniform 401 with a request id", async () => {
  const res = await me(request("/api/v1/me"), noParams);
  assert.equal(res.status, 401);
  assert.ok(res.headers.get("x-request-id"));
  assert.deepEqual(await res.json(), {
    error: { code: "unauthorized", message: "Sign in to continue." },
  });
});

test("first sign-in provisions everything, once, with a balanced ledger", async () => {
  const headers = await signIn("first-login", "Ada Lovelace");
  const res = await me(request("/api/v1/me", { headers }), noParams);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    user: { handle: string; initials: string };
    account: { id: string; cashCents: number; availableCents: number };
    wallets: { chain: string; custody: string }[];
  };
  assert.equal(body.user.handle, "firstlogin");
  assert.equal(body.user.initials, "AL");
  assert.equal(body.account.cashCents, 1_000_000);
  assert.deepEqual(body.wallets.map((w) => w.chain).sort(), [
    "ethereum",
    "solana",
  ]);

  const { db } = deps();
  const [ledger] = await db
    .select({ total: sql<number>`sum(${t.ledgerEntries.amount})::bigint` })
    .from(t.ledgerEntries)
    .where(eq(t.ledgerEntries.accountId, body.account.id));
  assert.equal(
    Number(ledger.total),
    10_000_000_000,
    "cash is backed by the ledger",
  );
  const prefs = await db.select().from(t.notificationPrefs);
  assert.equal(prefs.length, 8);
  const lists = await db
    .select()
    .from(t.watchlists)
    .where(eq(t.watchlists.isDefault, true));
  assert.equal(lists.length, 1);
  const events = await db
    .select()
    .from(t.outbox)
    .where(eq(t.outbox.type, "user.created"));
  assert.equal(events.length, 1);

  // Signing in again reuses everything.
  const again = await me(request("/api/v1/me", { headers }), noParams);
  assert.equal(
    ((await again.json()) as { account: { id: string } }).account.id,
    body.account.id,
  );
});

test("concurrent first requests converge on one person", async () => {
  const headers = await signIn("racer", "Race Condition");
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      me(request("/api/v1/me", { headers }), noParams),
    ),
  );
  const ids = new Set(
    await Promise.all(
      results.map(
        async (r) => ((await r.json()) as { user: { id: string } }).user.id,
      ),
    ),
  );
  assert.equal(ids.size, 1);
  const { db } = deps();
  const identities = await db
    .select()
    .from(t.authIdentities)
    .where(eq(t.authIdentities.subject, "racer"));
  assert.equal(identities.length, 1);
  const accounts = await db
    .select()
    .from(t.tradingAccounts)
    .where(eq(t.tradingAccounts.userId, [...ids][0]));
  assert.equal(accounts.length, 1);
});

test("invalid input is a 400 that names the field", async () => {
  const res = await devSession(
    request("/api/v1/dev/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.9.9.9",
      },
      body: JSON.stringify({ subject: "Not Valid!" }),
    }),
    noParams,
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as {
    error: { code: string; details: { fieldErrors: Record<string, string[]> } };
  };
  assert.equal(body.error.code, "bad_request");
  assert.ok(body.error.details.fieldErrors.subject);
});

test("sign-in attempts are rate limited per address", async () => {
  const attempt = () =>
    devSession(
      request("/api/v1/dev/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.7.7.7",
        },
        body: JSON.stringify({ subject: "limited" }),
      }),
      noParams,
    );
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await attempt()).status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[6], 429);
});
