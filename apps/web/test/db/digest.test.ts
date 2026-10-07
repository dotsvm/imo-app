import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { renderMail } from "@imo/server/mail/templates";
import { createWorker } from "@imo/server/worker";
import { GET as me } from "../../src/app/api/v1/me/route";
import { PATCH as setPref } from "../../src/app/api/v1/me/notification-preferences/[id]/route";
import { PUT as follow } from "../../src/app/api/v1/traders/[handle]/follow/route";
import { POST as post } from "../../src/app/api/v1/posts/route";
import { GET as unsubscribe } from "../../src/app/api/v1/email/unsubscribe/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void; set(at: string): void; now(): Date };
type Mail = { template: string; to: string; data: { items?: { author: string }[] } & Record<string, unknown>; unsubscribeUrl?: string };
const mailer = () => deps().mailer as unknown as { sent: Mail[] };
const auth: Record<string, string> = {};
const handle: Record<string, string> = {};
let worker: ReturnType<typeof createWorker>;

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "digest-tests" });
  clock().set("2026-09-25T15:00:00Z");
  for (const [who, name, email] of [["reader", "Rae Reader", "rae@example.com"], ["author", "Ash Author", "ash@example.com"]] as const) {
    auth[who] = await signIn(`digest-${who}`, name, email);
    handle[who] = (await call<{ user: { handle: string } }>(me, "/api/v1/me", { auth: auth[who] })).body.user.handle;
  }
});
after(async () => deps().close());
beforeEach(() => clock().advance(60_000));

test("the digest gathers a day of predictions from people you follow, once, at 13:00 UTC", async () => {
  await call(setPref, "/api/v1/me/notification-preferences/digest", { auth: auth.reader, method: "PATCH", params: { id: "digest" }, body: { email: true } });
  await call(follow, `/api/v1/traders/${handle.author}/follow`, { auth: auth.reader, method: "PUT", params: { handle: handle.author } });
  for (const [market, text] of [
    ["fed-dec", "Two dovish voters and a softer core services path: December is more live than the curve says."],
    ["cpi-oct", "Shelter is rolling over and used cars are flat; October core prints soft, and the headline follows it."],
  ] as const)
    await call(post, "/api/v1/posts", { auth: auth.author, body: { market, outcome: "Yes", text, confidence: "Medium" } });

  assert.deepEqual(await worker.run("digest"), { queued: 0 }, "not at 15:00");
  clock().set("2026-09-26T13:05:00Z");
  assert.deepEqual(await worker.run("digest"), { queued: 1 });
  await worker.run("jobs");
  const digest = mailer().sent.find((m) => m.template === "digest");
  assert.ok(digest);
  assert.equal(digest.to, "rae@example.com");
  assert.equal(digest.data.items?.length, 2);
  assert.match(digest.unsubscribeUrl ?? "", /\/api\/v1\/email\/unsubscribe\?token=/);
  const rendered = renderMail("digest", digest.data, "https://hunch.example", digest.unsubscribeUrl);
  assert.equal(rendered.subject, "2 new predictions from traders you follow");
  assert.match(rendered.html, /unsubscribe from these/);

  clock().advance(10 * 60_000);
  assert.deepEqual(await worker.run("digest"), { queued: 0 }, "once a day");
});

test("one click unsubscribes from that kind of email, and only that kind", async () => {
  const digest = mailer().sent.find((m) => m.template === "digest")!;
  const link = new URL(digest.unsubscribeUrl!);
  const res = await unsubscribe(new NextRequest(link), { params: Promise.resolve({}) });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location") ?? "", /unsubscribed=digest/);
  const [reader] = await deps().db.select({ id: t.users.id }).from(t.users).where(eq(t.users.handle, handle.reader));
  const prefs = await deps().db.select().from(t.notificationPrefs).where(eq(t.notificationPrefs.userId, reader.id));
  assert.equal(prefs.find((p) => p.kind === "digest")?.email, false);
  assert.equal(prefs.find((p) => p.kind === "order-filled")?.email, true, "other emails stay on");

  const forged = await unsubscribe(new NextRequest(`${link.origin}${link.pathname}?token=${"x".repeat(40)}`), { params: Promise.resolve({}) });
  assert.match(forged.headers.get("location") ?? "", /unsubscribed=invalid/);
});

test("notification emails carry their own unsubscribe link", async () => {
  await call(setPref, "/api/v1/me/notification-preferences/followers", { auth: auth.author, method: "PATCH", params: { id: "followers" }, body: { email: true } });
  await deps().db.delete(t.follows).where(and(eq(t.follows.followeeId, (await deps().db.select().from(t.users).where(eq(t.users.handle, handle.author)))[0].id)));
  await call(follow, `/api/v1/traders/${handle.author}/follow`, { auth: auth.reader, method: "PUT", params: { handle: handle.author } });
  for (let i = 0; i < 4; i++) if (!((await worker.run("outbox")) as { seen: number }).seen) break;
  await worker.run("jobs");
  const mail = mailer().sent.find((m) => m.template === "notification" && m.to === "ash@example.com");
  assert.ok(mail, "a verified address that opted in gets the email");
  assert.match(mail.unsubscribeUrl ?? "", /token=/);
});
