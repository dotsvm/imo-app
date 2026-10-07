import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { createWorker } from "@imo/server/worker";
import { GET as me, PATCH as patchMe } from "../../src/app/api/v1/me/route";
import { POST as changeEmail } from "../../src/app/api/v1/me/email/route";
import { GET as verify } from "../../src/app/api/v1/email/verify/route";
import { GET as prefs } from "../../src/app/api/v1/me/notification-preferences/route";
import { PATCH as setPref } from "../../src/app/api/v1/me/notification-preferences/[id]/route";
import { GET as traders } from "../../src/app/api/v1/traders/route";
import { GET as trader } from "../../src/app/api/v1/traders/[handle]/route";
import { DELETE as unfollow, PUT as follow } from "../../src/app/api/v1/traders/[handle]/follow/route";
import { PUT as bell } from "../../src/app/api/v1/traders/[handle]/bell/route";
import { GET as watchlists, POST as newList } from "../../src/app/api/v1/watchlists/route";
import { DELETE as dropList, PATCH as renameList } from "../../src/app/api/v1/watchlists/[id]/route";
import { DELETE as unlist, PUT as place } from "../../src/app/api/v1/watchlists/[id]/markets/[slug]/route";
import { GET as feed, POST as post } from "../../src/app/api/v1/posts/route";
import { DELETE as deletePost, GET as getPost, PATCH as editPost } from "../../src/app/api/v1/posts/[id]/route";
import { DELETE as unreact, PUT as react } from "../../src/app/api/v1/posts/[id]/reactions/[kind]/route";
import { POST as comment } from "../../src/app/api/v1/posts/[id]/comments/route";
import { POST as views } from "../../src/app/api/v1/posts/views/route";
import { POST as upload } from "../../src/app/api/v1/uploads/route";
import { POST as place_order } from "../../src/app/api/v1/orders/route";
import { GET as notifications } from "../../src/app/api/v1/notifications/route";
import { GET as alerts, POST as newAlert } from "../../src/app/api/v1/alerts/route";
import { GET as search } from "../../src/app/api/v1/search/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void; now(): Date };
const mailer = () => deps().mailer as unknown as { sent: { template: string; to: string; data: Record<string, string> }[] };
const storage = () => deps().storage as unknown as { put(key: string, type: string, bytes: number): void };
let worker: ReturnType<typeof createWorker>;
const auth: Record<string, string> = {};
const handle: Record<string, string> = {};
let n = 0;
const cid = () => `social-${Date.now().toString(36)}-${n++}`;

type Notice = { title: string; body: string; href: string; cta?: { label: string } };
const noticesFor = async (who: string) =>
  (await call<{ items: Notice[] }>(notifications, "/api/v1/notifications", { auth: auth[who] })).body.items;

async function relay() {
  for (let i = 0; i < 6; i++) {
    const { seen } = (await worker.run("outbox")) as { seen: number };
    if (!seen) break;
  }
}

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "social-tests" });
  for (const [who, name] of [["ada", "Ada Lovelace"], ["bo", "Bo Diddley"], ["cy", "Cy Young"]] as const) {
    auth[who] = await signIn(`social-${who}`, name, `${who}@example.com`);
    handle[who] = ((await call<{ user: { handle: string } }>(me, "/api/v1/me", { auth: auth[who] })).body.user.handle);
  }
});
after(async () => deps().close());
// Time passes between steps, as it does for people: rate budgets refill.
beforeEach(() => clock().advance(30_000));

test("following someone tells them, rings the bell, and shapes suggestions", async () => {
  const followed = await call<{ followers: number; viewer: { following: boolean } }>(follow, `/api/v1/traders/${handle.bo}/follow`, {
    auth: auth.ada,
    method: "PUT",
    params: { handle: handle.bo },
  });
  assert.equal(followed.status, 200);
  assert.deepEqual([followed.body.followers, followed.body.viewer.following], [1, true]);
  const again = await call<{ followers: number }>(follow, `/api/v1/traders/${handle.bo}/follow`, { auth: auth.ada, method: "PUT", params: { handle: handle.bo } });
  assert.equal(again.body.followers, 1, "following twice is still one follow");

  await relay();
  assert.equal((await noticesFor("bo"))[0].title, "Ada Lovelace followed you");

  const rung = await call<{ viewer: { notify: boolean } }>(bell, `/api/v1/traders/${handle.bo}/bell`, { auth: auth.ada, method: "PUT", params: { handle: handle.bo } });
  assert.equal(rung.body.viewer.notify, true);

  const suggested = await call<{ items: { handle: string }[] }>(traders, "/api/v1/traders?suggested=true", { auth: auth.ada });
  const names = suggested.body.items.map((i) => i.handle);
  assert.ok(!names.includes(handle.ada) && !names.includes(handle.bo), "not you, not people you follow");
  assert.ok(names.includes(handle.cy));

  const self = await call(follow, `/api/v1/traders/${handle.ada}/follow`, { auth: auth.ada, method: "PUT", params: { handle: handle.ada } });
  assert.equal(self.status, 422);

  await call(unfollow, `/api/v1/traders/${handle.cy}/follow`, { auth: auth.ada, method: "DELETE", params: { handle: handle.cy } });
  const profile = await call<{ followers: number; history: unknown[] }>(trader, `/api/v1/traders/${handle.bo}`, { params: { handle: handle.bo } });
  assert.equal(profile.body.followers, 1);
});

test("your profile and settings: handles are unique, safety notices stay on", async () => {
  const updated = await call<{ user: { handle: string; displayName: string }; settings: { theme: string; interests: string[] } }>(patchMe, "/api/v1/me", {
    auth: auth.cy,
    method: "PATCH",
    body: { displayName: "Cy Young", handle: "cyclone", bio: "Pitching probabilities.", theme: "Dim", interests: ["Sports", "Economics"] },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual([updated.body.user.handle, updated.body.settings.theme], ["cyclone", "Dim"]);
  handle.cy = "cyclone";

  const taken = await call<{ error: { code: string } }>(patchMe, "/api/v1/me", { auth: auth.bo, method: "PATCH", body: { handle: "CYCLONE" } });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, "handle_taken");
  const unknownField = await call(patchMe, "/api/v1/me", { auth: auth.bo, method: "PATCH", body: { role: "admin" } });
  assert.equal(unknownField.status, 400, "no sneaking in other fields");

  const off = await call<{ items: { id: string; email: boolean }[] }>(setPref, "/api/v1/me/notification-preferences/followers", {
    auth: auth.cy,
    method: "PATCH",
    params: { id: "followers" },
    body: { email: true },
  });
  assert.equal(off.body.items.find((i) => i.id === "followers")?.email, true);
  const locked = await call(setPref, "/api/v1/me/notification-preferences/order-failed", {
    auth: auth.cy,
    method: "PATCH",
    params: { id: "order-failed" },
    body: { app: false },
  });
  assert.equal(locked.status, 422);
  const list = await call<{ items: { id: string }[] }>(prefs, "/api/v1/me/notification-preferences", { auth: auth.cy });
  assert.equal(list.body.items.length, 8);
});

test("a new email is confirmed by the link we mail, and only the latest one counts", async () => {
  await call(changeEmail, "/api/v1/me/email", { auth: auth.bo, body: { email: "bo@new.example" } });
  await worker.run("jobs");
  const mail = mailer().sent.find((m) => m.to === "bo@new.example");
  assert.ok(mail, "a confirmation was mailed");
  const link = new URL(mail.data.link);
  const confirmed = await verify(new (await import("next/server")).NextRequest(link), { params: Promise.resolve({}) });
  assert.equal(confirmed.status, 303);
  assert.match(confirmed.headers.get("location") ?? "", /email=verified/);
  const [row] = await deps().db.select().from(t.userSettings).innerJoin(t.users, eq(t.users.id, t.userSettings.userId)).where(eq(t.users.handle, handle.bo));
  assert.ok(row.user_settings.emailVerifiedAt);

  await call(changeEmail, "/api/v1/me/email", { auth: auth.bo, body: { email: "bo@newer.example" } });
  const stale = await verify(new (await import("next/server")).NextRequest(link), { params: Promise.resolve({}) });
  assert.match(stale.headers.get("location") ?? "", /email=invalid/, "the old link no longer confirms anything");
});

test("watchlists keep your order through adds, moves and removals", async () => {
  const lists = async () => (await call<{ items: { id: string; name: string; isDefault: boolean; marketIds: string[] }[] }>(watchlists, "/api/v1/watchlists", { auth: auth.ada })).body.items;
  assert.deepEqual((await lists()).map((l) => [l.name, l.isDefault]), [["Saved markets", true]]);
  for (const slug of ["fed-dec", "cpi-oct", "btc"])
    await call(place, `/api/v1/watchlists/saved/markets/${slug}`, { auth: auth.ada, method: "PUT", params: { id: "saved", slug } });
  const moved = await call<{ marketIds: string[] }>(place, "/api/v1/watchlists/saved/markets/btc", {
    auth: auth.ada,
    method: "PUT",
    params: { id: "saved", slug: "btc" },
    body: { index: 0 },
  });
  assert.deepEqual(moved.body.marketIds, ["btc", "fed-dec", "cpi-oct"]);
  const removed = await call<{ marketIds: string[] }>(unlist, "/api/v1/watchlists/saved/markets/fed-dec", { auth: auth.ada, method: "DELETE", params: { id: "saved", slug: "fed-dec" } });
  assert.deepEqual(removed.body.marketIds, ["btc", "cpi-oct"]);

  const created = await call<{ id: string; marketIds: string[] }>(newList, "/api/v1/watchlists", { auth: auth.ada, body: { name: "Rates", market: "fed-dec" } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.marketIds, ["fed-dec"]);
  const renamed = await call<{ name: string }>(renameList, `/api/v1/watchlists/${created.body.id}`, { auth: auth.ada, method: "PATCH", params: { id: created.body.id }, body: { name: "Rates desk" } });
  assert.equal(renamed.body.name, "Rates desk");
  const saved = (await lists()).find((l) => l.isDefault)!;
  const keep = await call(dropList, `/api/v1/watchlists/${saved.id}`, { auth: auth.ada, method: "DELETE", params: { id: saved.id } });
  assert.equal(keep.status, 409, "the Saved list stays");
  const gone = await call(dropList, `/api/v1/watchlists/${created.body.id}`, { auth: auth.ada, method: "DELETE", params: { id: created.body.id } });
  assert.equal(gone.status, 200);
  const other = await call(renameList, `/api/v1/watchlists/${saved.id}`, { auth: auth.bo, method: "PATCH", params: { id: saved.id }, body: { name: "Mine now" } });
  assert.equal(other.status, 404, "someone else's list doesn't exist for you");
});

type PostView = {
  id: string;
  entryPrice: number;
  evidenceShares: number;
  position: { shares: number } | null;
  editableUntil: string | null;
  likes: number;
  images: { src: string; alt: string }[];
  viewer: { liked: boolean; bookmarked: boolean } | null;
  comments: { id: string; parentId?: string; text: string }[];
};
let postId = "";

test("a prediction is stamped with the market's price and the author's real position", async () => {
  // Ada holds 153 Yes on fed-dec: her evidence is attested from the ledger.
  await call(place_order, "/api/v1/orders", {
    auth: auth.ada,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 10_000, clientOrderId: cid() },
  });
  const ticket = await call<{ key: string }>(upload, "/api/v1/uploads", { auth: auth.ada, body: { purpose: "evidence", contentType: "image/png", bytes: 20_000 } });
  assert.equal(ticket.status, 201);
  const svg = await call(upload, "/api/v1/uploads", { auth: auth.ada, body: { purpose: "evidence", contentType: "image/svg+xml", bytes: 2_000 } });
  assert.equal(svg.status, 422, "SVG can carry script: not accepted");

  const body = {
    market: "fed-dec",
    outcome: "Yes",
    text: "Two voters moved dovish in the minutes, and core services is cooling faster than the dots assumed. December is live.",
    confidence: "Medium",
    disclosePosition: true,
    images: [{ key: ticket.body.key, alt: "Dot plot, September vs June", width: 640, height: 360 }],
    clientId: cid(),
  };
  const early = await call(post, "/api/v1/posts", { auth: auth.ada, body });
  assert.equal(early.status, 422, "the image has to be uploaded first");
  storage().put(ticket.body.key, "image/png", 20_000);

  const created = await call<PostView>(post, "/api/v1/posts", { auth: auth.ada, body });
  assert.equal(created.status, 201);
  assert.equal(created.body.entryPrice, 62, "stamped from the live quote, not typed in");
  assert.equal(created.body.evidenceShares, 153);
  assert.equal(created.body.position?.shares, 153);
  assert.ok(created.body.editableUntil);
  assert.equal(created.body.images[0].alt, "Dot plot, September vs June");
  postId = created.body.id;

  const retry = await call<PostView>(post, "/api/v1/posts", { auth: auth.ada, body });
  assert.equal(retry.body.id, postId, "a retried post lands once");

  // Any length up to 600: nothing at all, or more than that, is refused.
  const empty = await call(post, "/api/v1/posts", { auth: auth.ada, body: { ...body, text: "   ", clientId: cid() } });
  assert.equal(empty.status, 400);
  const long = await call(post, "/api/v1/posts", { auth: auth.ada, body: { ...body, text: "x".repeat(601), clientId: cid() } });
  assert.equal(long.status, 400);
  const foreign = await call(post, "/api/v1/posts", { auth: auth.bo, body: { ...body, clientId: cid() } });
  assert.equal(foreign.status, 403, "someone else's upload can't be attached");

  await relay();
  const [notice] = await noticesFor("bo");
  assert.equal(notice.title, "Ada Lovelace followed you", "Bo didn't ring Ada's bell");
});

test("edits and deletions close five minutes after posting", async () => {
  const edited = await call<PostView & { text: string }>(editPost, `/api/v1/posts/${postId}`, {
    auth: auth.ada,
    method: "PATCH",
    params: { id: postId },
    body: { confidence: "High" },
  });
  assert.equal(edited.status, 200);
  const notYours = await call(editPost, `/api/v1/posts/${postId}`, { auth: auth.bo, method: "PATCH", params: { id: postId }, body: { confidence: "Low" } });
  assert.equal(notYours.status, 403);
  clock().advance(6 * 60_000);
  const late = await call<{ error: { code: string } }>(editPost, `/api/v1/posts/${postId}`, { auth: auth.ada, method: "PATCH", params: { id: postId }, body: { confidence: "Low" } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, "locked");
  const kept = await call(deletePost, `/api/v1/posts/${postId}`, { auth: auth.ada, method: "DELETE", params: { id: postId } });
  assert.equal(kept.status, 409, "on the record for good");
});

test("reactions count once per person, and feeds find the post", async () => {
  for (let i = 0; i < 2; i++)
    await call(react, `/api/v1/posts/${postId}/reactions/like`, { auth: auth.bo, method: "PUT", params: { id: postId, kind: "like" } });
  await call(react, `/api/v1/posts/${postId}/reactions/bookmark`, { auth: auth.bo, method: "PUT", params: { id: postId, kind: "bookmark" } });
  let view = (await call<PostView>(getPost, `/api/v1/posts/${postId}`, { auth: auth.bo, params: { id: postId } })).body;
  assert.deepEqual([view.likes, view.viewer?.liked, view.viewer?.bookmarked], [1, true, true]);
  await call(unreact, `/api/v1/posts/${postId}/reactions/like`, { auth: auth.bo, method: "DELETE", params: { id: postId, kind: "like" } });
  view = (await call<PostView>(getPost, `/api/v1/posts/${postId}`, { auth: auth.bo, params: { id: postId } })).body;
  assert.equal(view.likes, 0);

  const ids = async (query: string, who?: string) =>
    (await call<{ items: { id: string }[] }>(feed, `/api/v1/posts?${query}`, { auth: who ? auth[who] : undefined })).body.items.map((p) => p.id);
  assert.ok((await ids("feed=latest")).includes(postId));
  assert.ok((await ids("feed=for-you")).includes(postId));
  assert.ok((await ids("feed=bookmarks", "bo")).includes(postId));
  assert.ok((await ids("market=fed-dec")).includes(postId));
  assert.ok((await ids(`trader=${handle.ada}`)).includes(postId));
  assert.ok(!(await ids("feed=following", "bo")).includes(postId), "Bo doesn't follow Ada");

  const counted = await call<{ counted: number }>(views, "/api/v1/posts/views", { auth: auth.bo, body: { ids: [postId, postId] } });
  assert.equal(counted.body.counted, 1);
  const twice = await call<{ counted: number }>(views, "/api/v1/posts/views", { auth: auth.bo, body: { ids: [postId] } });
  assert.equal(twice.body.counted, 0, "one view per person per six hours");
});

test("replies thread one level deep and reach the people they're for", async () => {
  const first = await call<{ id: string }>(comment, `/api/v1/posts/${postId}/comments`, {
    auth: auth.bo,
    params: { id: postId },
    body: { text: "What about the SEP dots? That seems like the bigger tell." },
  });
  assert.equal(first.status, 201);
  const reply = await call<{ id: string; parentId: string }>(comment, `/api/v1/posts/${postId}/comments`, {
    auth: auth.ada,
    params: { id: postId },
    body: { text: "Fair — the dots moved too.", parentId: first.body.id },
  });
  const nested = await call<{ parentId: string }>(comment, `/api/v1/posts/${postId}/comments`, {
    auth: auth.cy,
    params: { id: postId },
    body: { text: `Agree with @${handle.bo} here.`, parentId: reply.body.id },
  });
  assert.equal(nested.body.parentId, first.body.id, "a reply to a reply joins the thread");

  await relay();
  const ada = await noticesFor("ada");
  assert.ok(ada.some((n) => n.title === "Bo Diddley replied to your prediction"));
  assert.ok(ada.some((n) => n.title === "Cy Young replied to your prediction"));
  const bo = await noticesFor("bo");
  assert.ok(bo.some((n) => n.title === "Ada Lovelace replied to your comment"));
  assert.ok(bo.some((n) => n.title === "Cy Young mentioned you"));
  assert.equal(bo.filter((n) => n.title.startsWith("Cy Young")).length, 1, "one comment, one notice each");
  const view = (await call<PostView>(getPost, `/api/v1/posts/${postId}`, { params: { id: postId } })).body;
  assert.equal(view.comments.length, 3);
});

test("price alerts fire once, in the design's words", async () => {
  const created = await call<{ id: string }>(newAlert, "/api/v1/alerts", {
    auth: auth.cy,
    body: { market: "fed-dec", outcome: "Yes", thresholdCents: 60, direction: "above" },
  });
  assert.equal(created.status, 201);
  const fired = (await worker.run("alerts")) as { fired: number };
  assert.equal(fired.fired, 1);
  const [notice] = await noticesFor("cy");
  assert.equal(notice.title, "Fed cuts in December crossed 60¢");
  assert.equal(notice.body, "Yes is trading at 62¢, up 4 points over 24 hours.");
  assert.equal(((await worker.run("alerts")) as { fired: number }).fired, 0);
  const list = await call<{ items: { active: boolean }[] }>(alerts, "/api/v1/alerts", { auth: auth.cy });
  assert.equal(list.body.items[0].active, false);
});

test("holders hear a day before their market closes", async () => {
  await deps()
    .db.update(t.markets)
    .set({ closesAt: new Date("2026-09-25T20:00:00Z") })
    .where(eq(t.markets.slug, "fed-dec"));
  const first = (await worker.run("closing")) as { sent: number };
  assert.equal(first.sent, 1);
  const closing = (await noticesFor("ada")).find((n) => n.title === "Fed cuts in December closes within a day");
  assert.equal(closing?.body, "You hold 153 Yes. Trading stops Sep 25, 8:00 PM UTC.");
  assert.equal(((await worker.run("closing")) as { sent: number }).sent, 0, "told once");
});

test("search finds markets, traders and predictions", async () => {
  const { body } = await call<{ markets: { id: string }[]; traders: { handle: string }[]; posts: { id: string }[] }>(search, "/api/v1/search?q=dovish");
  assert.ok(body.posts.some((p) => p.id === postId));
  const people = await call<{ traders: { handle: string }[] }>(search, "/api/v1/search?q=cyclo");
  assert.deepEqual(people.body.traders.map((t) => t.handle), ["cyclone"]);
  const markets = await call<{ markets: { id: string }[] }>(search, "/api/v1/search?q=Fed cuts");
  assert.equal(markets.body.markets[0].id, "fed-dec");
});
