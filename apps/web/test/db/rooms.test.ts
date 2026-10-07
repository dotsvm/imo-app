import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { createWorker } from "@imo/server/worker";
import { GET as me } from "../../src/app/api/v1/me/route";
import { GET as rooms, POST as newRoom } from "../../src/app/api/v1/rooms/route";
import { GET as room, PATCH as patchRoom } from "../../src/app/api/v1/rooms/[slug]/route";
import { DELETE as leave, PUT as join } from "../../src/app/api/v1/rooms/[slug]/join/route";
import { POST as ask } from "../../src/app/api/v1/rooms/[slug]/requests/route";
import { POST as answer } from "../../src/app/api/v1/rooms/[slug]/requests/[handle]/route";
import { DELETE as remove, PATCH as role } from "../../src/app/api/v1/rooms/[slug]/members/[handle]/route";
import { GET as messages, POST as say } from "../../src/app/api/v1/rooms/[slug]/channels/[channel]/messages/route";
import { POST as read } from "../../src/app/api/v1/rooms/[slug]/channels/[channel]/read/route";
import { POST as shareMarkets } from "../../src/app/api/v1/rooms/[slug]/markets/route";
import { POST as archive } from "../../src/app/api/v1/rooms/[slug]/archive/route";
import { POST as channel } from "../../src/app/api/v1/rooms/[slug]/channels/route";
import { DELETE as unsay } from "../../src/app/api/v1/rooms/[slug]/messages/[id]/route";
import { GET as feed, POST as post } from "../../src/app/api/v1/posts/route";
import { GET as getPost } from "../../src/app/api/v1/posts/[id]/route";
import { POST as order } from "../../src/app/api/v1/orders/route";
import { GET as notifications } from "../../src/app/api/v1/notifications/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void };
const realtime = () => deps().realtime as unknown as { messages: { channel: string; event: string; payload: Record<string, unknown> }[] };
let worker: ReturnType<typeof createWorker>;
const auth: Record<string, string> = {};
const handle: Record<string, string> = {};

type Room = {
  id: string;
  role: string | null;
  memberCount: number;
  locked: boolean;
  unread: number;
  realtime: string;
  watchlist: string[];
  channels: { id: string; unread: number; marketId?: string }[];
  requests: { handle: string }[];
};
type Message = { id: string; text: string; kind?: string; parentId?: string; replies: { count: number } | null; holdings: { outcome: string; shares: number }[] };

const titles = async (who: string) =>
  (await call<{ items: { title: string }[] }>(notifications, "/api/v1/notifications", { auth: auth[who] })).body.items.map((n) => n.title);
async function relay() {
  for (let i = 0; i < 6; i++) if (!((await worker.run("outbox")) as { seen: number }).seen) break;
}
const get = (who: string | null, slug: string) =>
  call<Room>(room, `/api/v1/rooms/${slug}`, { auth: who ? auth[who] : undefined, params: { slug } });

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  worker = createWorker(deps(), { holder: "room-tests" });
  for (const [who, name] of [["ada", "Ada Lovelace"], ["bo", "Bo Diddley"], ["cy", "Cy Young"]] as const) {
    auth[who] = await signIn(`rooms-${who}`, name);
    handle[who] = (await call<{ user: { handle: string } }>(me, "/api/v1/me", { auth: auth[who] })).body.user.handle;
  }
});
after(async () => deps().close());
beforeEach(() => clock().advance(30_000));

test("a new room starts with its owner, a general channel and its markets", async () => {
  const created = await call<Room>(newRoom, "/api/v1/rooms", {
    auth: auth.ada,
    body: { name: "Macro Room", description: "Rates and jobs.", privacy: "Public", watchlist: ["fed-dec", "cpi-oct"], disclosure: true },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "macro-room");
  assert.equal(created.body.role, "Owner");
  assert.deepEqual(created.body.channels.map((c) => c.id), ["general", "predictions"]);
  assert.deepEqual(created.body.watchlist, ["fed-dec", "cpi-oct"]);
  const withChannel = await call<Room>(channel, "/api/v1/rooms/macro-room/channels", {
    auth: auth.ada,
    params: { slug: "macro-room" },
    body: { name: "FOMC December", topic: "Dec 16 decision", market: "fed-dec" },
  });
  assert.deepEqual(withChannel.body.channels.find((c) => c.id === "fomc-december")?.marketId, "fed-dec");
});

test("joining a public room shows in #general, and members hear what's for them", async () => {
  const joined = await call<Room>(join, "/api/v1/rooms/macro-room/join", { auth: auth.bo, method: "PUT", params: { slug: "macro-room" } });
  assert.deepEqual([joined.body.role, joined.body.memberCount], ["Member", 2]);
  clock().advance(1_000);

  const said = await call<Message>(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "general" },
    body: { text: `Welcome @${handle.bo} — what's your December read?` },
  });
  assert.equal(said.status, 201);
  await relay();
  assert.ok((await titles("bo")).includes("Ada Lovelace mentioned you in Macro Room"));
  const pushed = realtime().messages.filter((m) => m.channel === joined.body.realtime && m.event === "message");
  assert.ok(pushed.some((m) => m.payload.id === said.body.id), "members see it live");

  const unread = await get("bo", "macro-room");
  assert.equal(unread.body.channels.find((c) => c.id === "general")?.unread, 1, "your own join line doesn't count");
  await call(read, "/api/v1/rooms/macro-room/channels/general/read", { auth: auth.bo, params: { slug: "macro-room", channel: "general" } });
  assert.equal((await get("bo", "macro-room")).body.channels.find((c) => c.id === "general")?.unread, 0);

  const page = await call<{ items: Message[] }>(messages, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.bo,
    params: { slug: "macro-room", channel: "general" },
  });
  assert.deepEqual(page.body.items.map((m) => m.kind ?? "message"), ["join", "message"]);
});

test("threads keep replies under their message, one level deep", async () => {
  const top = await call<Message>(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.bo,
    params: { slug: "macro-room", channel: "general" },
    body: { text: "Holding No until the October core print." },
  });
  const reply = await call<Message>(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "general" },
    body: { text: "Fair. 0.2 or lower changes it for me too.", parentId: top.body.id },
  });
  const deeper = await call<Message>(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.bo,
    params: { slug: "macro-room", channel: "general" },
    body: { text: "Agreed.", parentId: reply.body.id },
  });
  assert.equal(deeper.body.parentId, top.body.id);
  await relay();
  assert.ok((await titles("bo")).includes("Ada Lovelace replied in your thread in Macro Room"));

  const thread = await call<{ parent: Message; items: Message[] }>(messages, `/api/v1/rooms/macro-room/channels/general/messages?thread=${top.body.id}`, {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "general" },
  });
  assert.equal(thread.body.items.length, 2);
  assert.equal(thread.body.parent.replies?.count, 2);
  const removed = await call(unsay, `/api/v1/rooms/macro-room/messages/${deeper.body.id}`, {
    auth: auth.ada,
    method: "DELETE",
    params: { slug: "macro-room", id: deeper.body.id },
  });
  assert.equal(removed.status, 200, "the owner moderates");
});

test("with disclosure on, messages about a market show what the author holds", async () => {
  await call(order, "/api/v1/orders", {
    auth: auth.ada,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 10_000, clientOrderId: "rooms-ada-fed-1" },
  });
  const said = await call<Message>(say, "/api/v1/rooms/macro-room/channels/fomc-december/messages", {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "fomc-december" },
    body: { text: "Adding here." },
  });
  assert.deepEqual(said.body.holdings, [{ outcome: "Yes", shares: 153 }]);
  const plain = await call<Message>(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "general" },
    body: { text: "Nothing linked." },
  });
  assert.deepEqual(plain.body.holdings, []);
});

test("an invite-only room shows its cover, takes requests, and lets moderators decide", async () => {
  await call(newRoom, "/api/v1/rooms", { auth: auth.cy, body: { name: "Quiet Desk", privacy: "Invite only", watchlist: [] } });
  const cover = await get("bo", "quiet-desk");
  assert.equal(cover.body.locked, true);
  assert.equal((cover.body as unknown as { channels?: unknown }).channels, undefined, "no channels for outsiders");
  const peek = await call(messages, "/api/v1/rooms/quiet-desk/channels/general/messages", { auth: auth.bo, params: { slug: "quiet-desk", channel: "general" } });
  assert.equal(peek.status, 403);
  const walkIn = await call(join, "/api/v1/rooms/quiet-desk/join", { auth: auth.bo, method: "PUT", params: { slug: "quiet-desk" } });
  assert.equal(walkIn.status, 403);

  await call(ask, "/api/v1/rooms/quiet-desk/requests", { auth: auth.bo, params: { slug: "quiet-desk" } });
  await relay();
  assert.ok((await titles("cy")).includes("Bo Diddley asked to join Quiet Desk"));
  const pending = await get("cy", "quiet-desk");
  assert.deepEqual(pending.body.requests.map((r) => r.handle), [handle.bo]);

  await call(answer, `/api/v1/rooms/quiet-desk/requests/${handle.bo}`, {
    auth: auth.cy,
    params: { slug: "quiet-desk", handle: handle.bo },
    body: { approve: true },
  });
  await relay();
  assert.ok((await titles("bo")).includes("You're in: Quiet Desk"));
  assert.equal((await get("bo", "quiet-desk")).body.role, "Member");

  await call(role, `/api/v1/rooms/quiet-desk/members/${handle.bo}`, {
    auth: auth.cy,
    method: "PATCH",
    params: { slug: "quiet-desk", handle: handle.bo },
    body: { role: "Moderator" },
  });
  await call(ask, "/api/v1/rooms/quiet-desk/requests", { auth: auth.ada, params: { slug: "quiet-desk" } });
  const approved = await call<Room>(answer, `/api/v1/rooms/quiet-desk/requests/${handle.ada}`, {
    auth: auth.bo,
    params: { slug: "quiet-desk", handle: handle.ada },
    body: { approve: true },
  });
  assert.equal(approved.body.memberCount, 3, "moderators approve too");
  const mutiny = await call(remove, `/api/v1/rooms/quiet-desk/members/${handle.cy}`, {
    auth: auth.bo,
    method: "DELETE",
    params: { slug: "quiet-desk", handle: handle.cy },
  });
  assert.equal(mutiny.status, 403, "no one removes the owner");
  const removed = await call<Room>(remove, `/api/v1/rooms/quiet-desk/members/${handle.ada}`, {
    auth: auth.bo,
    method: "DELETE",
    params: { slug: "quiet-desk", handle: handle.ada },
  });
  assert.equal(removed.body.memberCount, 2);
});

test("sharing markets counts only the new ones and tells the members", async () => {
  const shared = await call<{ added: number; room: Room }>(shareMarkets, "/api/v1/rooms/macro-room/markets", {
    auth: auth.bo,
    params: { slug: "macro-room" },
    body: { markets: ["fed-dec", "btc", "btc"] },
  });
  assert.equal(shared.body.added, 1);
  assert.deepEqual(shared.body.room.watchlist, ["fed-dec", "cpi-oct", "btc"]);
  await relay();
  assert.ok((await titles("ada")).includes("New market in Macro Room"));
});

test("room predictions are for members, and the room feed gathers its markets", async () => {
  const text = "December is live: two dovish voters and a softer core services path. Room-only call, sized small.";
  const created = await call<{ id: string; audience: string }>(post, "/api/v1/posts", {
    auth: auth.ada,
    body: { market: "fed-dec", outcome: "Yes", text, confidence: "Low", audience: "macro-room" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.audience, "macro-room");
  const outsider = await call(getPost, `/api/v1/posts/${created.body.id}`, { auth: auth.cy, params: { id: created.body.id } });
  assert.equal(outsider.status, 404);
  const inside = await call<{ items: { id: string }[] }>(feed, "/api/v1/posts?room=macro-room", { auth: auth.bo });
  assert.ok(inside.body.items.some((p) => p.id === created.body.id));
  const notMember = await call(post, "/api/v1/posts", { auth: auth.cy, body: { market: "fed-dec", outcome: "No", text, confidence: "Low", audience: "macro-room" } });
  assert.equal(notMember.status, 403);
});

test("owners can't walk out; they archive, and archived rooms go quiet", async () => {
  const stay = await call(leave, "/api/v1/rooms/macro-room/join", { auth: auth.ada, method: "DELETE", params: { slug: "macro-room" } });
  assert.equal(stay.status, 409);
  const left = await call(leave, "/api/v1/rooms/macro-room/join", { auth: auth.bo, method: "DELETE", params: { slug: "macro-room" } });
  assert.equal(left.status, 200);
  const renamed = await call(patchRoom, "/api/v1/rooms/macro-room", { auth: auth.ada, method: "PATCH", params: { slug: "macro-room" }, body: { rules: "Link the market." } });
  assert.equal(renamed.status, 200);
  await call(archive, "/api/v1/rooms/macro-room/archive", { auth: auth.ada, params: { slug: "macro-room" } });
  const quiet = await call(say, "/api/v1/rooms/macro-room/channels/general/messages", {
    auth: auth.ada,
    params: { slug: "macro-room", channel: "general" },
    body: { text: "Anyone?" },
  });
  assert.equal(quiet.status, 409);
  const listed = await call<{ items: { id: string }[] }>(rooms, "/api/v1/rooms");
  assert.ok(!listed.body.items.some((r) => r.id === "macro-room"), "archived rooms leave the directory");
});

test("a room can start with a colour, topics and people already in it", async () => {
  const created = await call<Room & { color: string; topics: string[]; avatarUrl: string | null }>(newRoom, "/api/v1/rooms", {
    auth: auth.bo,
    body: {
      name: "Fed Watchers",
      description: "Rate calls, CPI prints and every FOMC week.",
      privacy: "Invite only",
      color: "sage",
      topics: ["Economy", "Fed", " fed ", "Rates"],
      invite: [`@${handle.ada}`, handle.cy, handle.bo, "nobody_here"],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.color, "#a9c4b1");
  assert.deepEqual(created.body.topics, ["Economy", "Fed", "Rates"], "trimmed and one of each");
  assert.equal(created.body.avatarUrl, null);
  assert.equal(created.body.memberCount, 3, "the owner plus the two real people added; not themselves, not strangers");
  // Added people are members of an invite-only room straight away…
  assert.equal((await get("cy", created.body.id)).body.role, "Member");
  // …and are told who added them.
  await relay();
  assert.ok((await titles("ada")).some((t) => /Bo Diddley added you to Fed Watchers/.test(t)));

  const picture = await call<{ error: { code: string } }>(newRoom, "/api/v1/rooms", {
    auth: auth.bo,
    body: { name: "Not Mine", privacy: "Public", avatarKey: `rooms/someone-else/x.png` },
  });
  assert.equal(picture.status, 403, "only your own upload can be a room's picture");
});
