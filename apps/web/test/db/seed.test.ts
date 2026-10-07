import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesign } from "@imo/server/demo/seed";
import { GET as me } from "../../src/app/api/v1/me/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { GET as trader } from "../../src/app/api/v1/traders/[handle]/route";
import { GET as feed } from "../../src/app/api/v1/posts/route";
import { GET as getPost } from "../../src/app/api/v1/posts/[id]/route";
import { GET as room } from "../../src/app/api/v1/rooms/[slug]/route";
import { GET as messages } from "../../src/app/api/v1/rooms/[slug]/channels/[channel]/messages/route";
import { GET as notifications } from "../../src/app/api/v1/notifications/route";
import { GET as watchlists } from "../../src/app/api/v1/watchlists/route";
import { GET as orders } from "../../src/app/api/v1/orders/route";
import { GET as board } from "../../src/app/api/v1/leaderboard/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
let you = "";

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  const first = await seedDesign(deps().db, deps().log);
  assert.ok(!("skipped" in first.social));
  const again = await seedDesign(deps().db, deps().log);
  assert.ok("skipped" in again.social, "seeding twice changes nothing");
  you = await signIn("you", "Jordan Reyes");
});
after(async () => deps().close());

test("the demo viewer signs in as Jordan, with the design's money", async () => {
  const { body } = await call<{ user: { handle: string; displayName: string }; account: { cashCents: number; reservedCents: number } }>(me, "/api/v1/me", { auth: you });
  assert.deepEqual([body.user.handle, body.user.displayName], ["jordan", "Jordan Reyes"]);
  assert.equal(body.account.cashCents, 907_985);
  assert.equal(body.account.reservedCents, 16_600 + 8_040, "the Fed limit and the BTC remainder hold cash");
  const rows = await deps().db.execute<{ ok: boolean }>(sql`
    select bool_and(a.cash = coalesce(l.total, 0)) as ok from trading_accounts a
    left join (select account_id, sum(amount) as total from ledger_entries group by account_id) l on l.account_id = a.id`);
  assert.equal(rows[0].ok, true, "every seeded account balances to its ledger");
});

test("positions, the claim and resting orders read back through the API", async () => {
  const p = await call<{ positions: { marketId: string; shares: number }[]; claims: { marketId: string; payoutCents: number }[]; closed: unknown[] }>(portfolio, "/api/v1/portfolio", { auth: you });
  assert.deepEqual(p.body.positions.map((x) => x.marketId).sort(), ["btc", "fed-dec", "jobs-sep", "mayor", "model", "stable"]);
  assert.equal(p.body.positions.find((x) => x.marketId === "fed-dec")?.shares, 180);
  assert.deepEqual(p.body.claims.map((c) => [c.marketId, c.payoutCents]), [["jobs-sep", 20_000]]);
  assert.equal(p.body.closed.length, 2);
  const resting = await call<{ items: { status: string; filledShares: number }[] }>(orders, "/api/v1/orders?status=resting", { auth: you });
  assert.deepEqual(resting.body.items.map((o) => [o.status, o.filledShares]).sort(), [["partial", 100], ["pending", 0]]);
});

test("traders keep the design's records and followings", async () => {
  const { body } = await call<{ name: string; followers: number; stats: Record<string, { pnlCents: number; resolved: number }>; history: unknown[]; curve30: number[] }>(trader, "/api/v1/traders/mirak", { params: { handle: "mirak" } });
  assert.equal(body.name, "Mira Kaplan");
  assert.equal(body.followers, 12_400);
  assert.equal(body.stats["30D"].pnlCents, 1_842_055);
  assert.equal(body.curve30.at(-1), 1_842_055);
  assert.ok(body.history.length >= 10);
  const top = await call<{ items: { trader: { handle: string } }[] }>(board, "/api/v1/leaderboard?period=30D");
  assert.ok(top.body.items.length > 5);
});

test("predictions, threads, rooms and notifications are all there", async () => {
  const latest = await call<{ items: { id: string; author: { handle: string }; commentCount: number }[] }>(feed, "/api/v1/posts?feed=latest&limit=50", { auth: you });
  assert.equal(latest.body.items.length, 7);
  const luis = latest.body.items.find((p) => p.author.handle === "lvprado" && p.commentCount === 4)!;
  const detail = await call<{ comments: { parentId?: string }[]; images: { src: string }[] }>(getPost, `/api/v1/posts/${luis.id}`, { auth: you, params: { id: luis.id } });
  assert.equal(detail.body.comments.filter((c) => c.parentId).length, 1);
  assert.match(detail.body.images[0].src, /^\/media\/.+\.svg$/);

  const desk = await call<{ role: string; notify: string; channels: { id: string }[]; watchlist: string[]; memberCount: number }>(room, "/api/v1/rooms/macro-desk", { auth: you, params: { slug: "macro-desk" } });
  assert.deepEqual([desk.body.role, desk.body.notify, desk.body.memberCount], ["Member", "Mentions", 1_284]);
  assert.equal(desk.body.channels.length, 5);
  assert.deepEqual(desk.body.watchlist, ["fed-dec", "cpi-oct", "jobs-sep", "stable", "mayor"]);
  const chat = await call<{ items: unknown[] }>(messages, "/api/v1/rooms/macro-desk/channels/general/messages", { auth: you, params: { slug: "macro-desk", channel: "general" } });
  assert.ok(chat.body.items.length > 0);

  const inbox = await call<{ items: { title: string; href: string }[]; unread: number }>(notifications, "/api/v1/notifications", { auth: you });
  assert.ok(inbox.body.items.some((n) => n.title === "Order filled"));
  assert.ok(inbox.body.items.every((n) => !/\/post\/post\d|\/trader\/(ren|mira|luis)$/.test(n.href)), "design links point at real ids");
  const lists = await call<{ items: { name: string }[] }>(watchlists, "/api/v1/watchlists", { auth: you });
  assert.deepEqual(lists.body.items.map((l) => l.name), ["Saved markets", "Rates & inflation", "Weather", "Long shots"]);
});
