import type { Page } from "@playwright/test";
import { api, expect, newTrader, secondTrader, test } from "../support";

/**
 * Rooms, written to: joining, posting, threads, waves, mentions, an unsent
 * message's retry, running a room of your own, invite-only approval, and a
 * message crossing to another member live. Every writer is a fresh trader,
 * and everything this file adds is unique to the run, so it passes again on
 * the same data.
 */

interface MessageDTO {
  id: string;
  text: string;
  marketId?: string;
  parentId?: string;
  author: { handle: string };
}
interface RoomDTO {
  id: string;
  name: string;
  privacy: string;
  role: string | null;
  rules: string;
  watchlist: string[];
  owner: { handle: string };
  members: { handle: string }[];
}

/** A tag unique to this run, for text a later run mustn't mistake for its own. */
const tag = () => Date.now().toString(36).slice(-6);

const messages = (page: Page, room: string, channel: string, thread?: string) =>
  api<{ items: MessageDTO[] }>(
    page,
    `rooms/${room}/channels/${channel}/messages?${thread ? `thread=${thread}` : "limit=100"}`,
  ).then((page) => page.items);

const join = (page: Page, room: string) => api(page, `rooms/${room}/join`, { method: "PUT" });

/** A room of one's own, made through the API: its slug. */
async function roomOf(page: Page, name: string, privacy: "Public" | "Invite only", watchlist: string[] = []) {
  const room = await api<RoomDTO>(page, "rooms", {
    data: { name, description: "Made by the end-to-end suite.", privacy, watchlist },
  });
  return room.id;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("a newcomer joins a public room, posts with a linked market, and can leave", async ({ page }) => {
  await newTrader(page, "Rowan Member");
  const text = `Core services cooled again (${tag()}).`;
  await page.goto("/rooms/macro-desk?channel=cpi-watch");
  await expect(page.locator("h1")).toHaveText("Macro Desk");
  const side = page.getByRole("navigation", { name: "Macro Desk channels and markets" });
  const log = page.getByRole("log", { name: "Messages in #cpi-watch" });
  // Reading, not posting: the composer waits behind Join.
  await expect(log).toContainText("Cleveland Fed nowcast");
  await expect(page.getByLabel("Message #cpi-watch")).toHaveCount(0);
  await expect(side.getByRole("button", { name: "Add a market to the room" })).toHaveCount(0);
  // Joining reloads the room in the background; writing straight away is
  // safe (a reload that began before a change is thrown away, not applied).
  await page.getByRole("button", { name: "Join · Macro Desk" }).click();
  const box = page.getByLabel("Message #cpi-watch");
  await expect(box).toBeEnabled();
  await expect(side.getByRole("button", { name: "Add a market to the room" })).toBeVisible();

  // A message with a linked market carries the market's card.
  await page.getByRole("button", { name: "Link a market" }).click();
  const link = page.getByRole("dialog", { name: "Link a market" });
  await link.getByRole("searchbox").fill("Fed December");
  await link.getByRole("button", { name: /^Fed cuts in December/ }).click();
  await expect(page.getByText("Linking Fed cuts in December")).toBeVisible();
  // Shift+Enter keeps writing; Enter sends.
  await box.fill(text);
  await box.press("Shift+Enter");
  await expect(box).toHaveValue(`${text}\n`);
  await box.press("Enter");
  await expect(box).toHaveValue("");
  const mine = log.locator("article[data-mine]").filter({ hasText: text });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole("link", { name: /^Fed cuts in December/ })).toBeVisible();
  // The server has it, linked (the trailing newline trimmed away).
  await expect
    .poll(async () => (await messages(page, "macro-desk", "cpi-watch")).find((m) => m.text.startsWith(text))?.marketId)
    .toBe("fed-dec");
  await page.reload();
  await expect(log).toContainText(text);

  // Leave from the room menu; the composer gives way to Join.
  await page.getByRole("button", { name: "Macro Desk menu" }).click();
  await page.getByRole("menuitem", { name: "Leave room" }).click();
  await expect(page.getByLabel("Message #cpi-watch")).toHaveCount(0);
  await expect.poll(async () => (await api<RoomDTO>(page, "rooms/macro-desk")).role).toBeNull();
  await page.getByRole("button", { name: "Join · Macro Desk" }).click();
  await expect(page.getByLabel("Message #cpi-watch")).toBeEnabled();
});

test("replies stay in their thread; waves and mentions work like team chat", async ({ page }) => {
  await newTrader(page, "Tess Thread");
  await join(page, "macro-desk");
  const reply = `Same read here (${tag()}).`;
  await page.goto("/rooms/macro-desk?channel=fomc-december");
  const log = page.getByRole("log", { name: "Messages in #fomc-december" });
  // Luis's thread: however many replies earlier runs left, one more.
  const summary = log.getByRole("article").filter({ hasText: "Counterpoint" }).getByRole("link", { name: /\d+ repl/ });
  const before = Number((await summary.innerText()).match(/^(\d+)/)![1]);
  await summary.click();
  await expect(page).toHaveURL(/thread=[0-9a-f-]{36}/);
  const root = new URL(page.url()).searchParams.get("thread")!;
  const thread = page.getByRole("region", { name: "Thread" });
  const box = thread.getByLabel("Reply to thread");
  await expect(box).toBeFocused();
  await box.fill(reply);
  await box.press("Enter");
  await expect(thread.getByRole("log")).toContainText(reply);
  await expect(thread.getByRole("separator", { name: `${before + 1} replies` })).toBeVisible();
  await expect(log.getByRole("link", { name: new RegExp(`^${before + 1} replies`) })).toBeVisible();
  await expect(log).not.toContainText(reply);
  await expect.poll(async () => (await messages(page, "macro-desk", "fomc-december", root)).map((m) => m.text)).toContain(reply);
  // Escape closes the thread and hands focus back to where it opened.
  await box.press("Escape");
  await expect(thread).toHaveCount(0);
  await expect(log.getByRole("link", { name: new RegExp(`^${before + 1} replies`) })).toBeFocused();

  // A wave says hello to someone who joined, once.
  await page.goto("/rooms/macro-desk?channel=general");
  const general = page.getByRole("log", { name: "Messages in #general" });
  const annJoined = general.getByRole("article").filter({ hasText: "joined #general along with Ren Tanaka." });
  await annJoined.getByRole("button", { name: "Wave to say hi" }).click();
  await expect(general.locator("article[data-mine]").last()).toContainText("👋 @Ann North");
  await expect(annJoined.getByRole("button", { name: "Wave to say hi" })).toHaveCount(0);

  // The composer's toolbar mentions people and adds emoji.
  const note = `Claims at 8:30 (${tag()})`;
  const composer = page.getByLabel("Message #general");
  await composer.fill(note);
  await page.getByRole("button", { name: "Mention someone" }).click();
  await page.getByRole("dialog", { name: "Mention someone" }).getByRole("button", { name: "Mira Kaplan" }).click();
  await page.getByRole("button", { name: "Add an emoji" }).click();
  await page.getByRole("dialog", { name: "Add an emoji" }).getByRole("button", { name: "👀" }).click();
  await expect(composer).toHaveValue(`${note} @Mira Kaplan 👀`);
  await page.getByRole("button", { name: "Send message" }).click();
  const sent = general.locator("article[data-mine]").filter({ hasText: note });
  await expect(sent.getByRole("link", { name: "@Mira Kaplan" })).toBeVisible();
  await expect
    .poll(async () => (await messages(page, "macro-desk", "general")).map((m) => m.text))
    .toContain(`${note} @Mira Kaplan 👀`);
});

test("a message sent offline waits with a retry (10.5)", async ({ page, context }) => {
  await newTrader(page, "Otto Offline");
  await join(page, "macro-desk");
  const text = `Anyone else see the claims print? (${tag()})`;
  await page.goto("/rooms/macro-desk?channel=general");
  const log = page.getByRole("log", { name: "Messages in #general" });
  const composer = page.getByLabel("Message #general");
  await expect(composer).toBeEnabled();
  await context.setOffline(true);
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  const unsent = log.getByRole("article").filter({ hasText: text });
  await expect(unsent.getByText(/Not sent/)).toBeVisible();
  await context.setOffline(false);
  // Nothing reached the server while the tab was offline.
  expect((await messages(page, "macro-desk", "general")).map((m) => m.text)).not.toContain(text);
  await unsent.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(log.getByText(/Not sent/)).toHaveCount(0);
  await expect(log.locator("article[data-mine]").filter({ hasText: text })).toBeVisible();
  await expect.poll(async () => (await messages(page, "macro-desk", "general")).map((m) => m.text)).toContain(text);
});

test("a room created in the dialog opens on its own page, seeded", async ({ page }) => {
  const owner = await newTrader(page, "Nia Owner");
  const name = `Jobs Report Club ${tag()}`;
  await page.goto("/rooms");
  // A newcomer is in no rooms yet.
  await page.getByRole("button", { name: "Joined", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("article").first()).toBeVisible();

  await page.getByRole("button", { name: "Create room" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a room" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("What’s it for?").fill("NFP, JOLTS and claims. One thread per release.");
  // 08.3: seed the shared watchlist from the market picker.
  await dialog.getByRole("button", { name: "Add market" }).click();
  const picker = page.getByRole("dialog", { name: "Add market" });
  await picker.getByRole("searchbox").fill("Oct CPI");
  await picker.getByRole("button", { name: /^Oct CPI above 3\.0%/ }).click();
  await dialog.getByRole("heading", { name: "Create a room" }).click();
  await expect(dialog.getByRole("button", { name: "Remove Oct CPI above 3.0%" })).toBeVisible();
  await dialog.getByRole("button", { name: "Create room" }).click();

  await expect(page.locator("h1")).toHaveText(name);
  const slug = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("navigation", { name: /channels and markets/ })).toContainText("Oct CPI above 3.0%");
  const made = await api<RoomDTO>(page, `rooms/${slug}`);
  expect(made).toMatchObject({ name, privacy: "Public", role: "Owner", watchlist: ["cpi-oct"] });
  expect(made.owner.handle).toBe(owner.handle);
  expect(made.members.map((m) => m.handle)).toEqual([owner.handle]);
});

test("an owner runs a room: posts, sets the rules, then archives it", async ({ page }) => {
  const owner = await newTrader(page, "Nia Owner");
  const name = `Jobs Report Club ${tag()}`;
  // Made through the API while the dialog can't open its room (see above).
  const slug = await roomOf(page, name, "Public", ["cpi-oct"]);
  await page.goto("/rooms");
  await page.getByRole("button", { name: "Joined", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText(name);
  await page.getByRole("article").getByRole("link", { name: new RegExp(name) }).click();

  await expect(page.locator("h1")).toHaveText(name);
  const side = page.getByRole("navigation", { name: `${name} channels and markets` });
  await expect(side).toContainText("Oct CPI above 3.0%");
  await page.getByLabel("Message #general").fill("Opening thread.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log", { name: "Messages in #general" })).toContainText("Opening thread.");
  const made = await api<RoomDTO>(page, `rooms/${slug}`);
  expect(made).toMatchObject({ name, privacy: "Public", role: "Owner", watchlist: ["cpi-oct"] });
  expect(made.owner.handle).toBe(owner.handle);
  expect(made.members.map((m) => m.handle)).toEqual([owner.handle]);

  // Room markets: add one through the picker, then take it off again.
  await side.getByRole("button", { name: "Add a market to the room" }).click();
  const picker = page.getByRole("dialog", { name: "Add a market to the room" });
  await picker.getByRole("searchbox").fill("landfall");
  const added = side.getByRole("link", { name: /^Cat 4 US landfall/ });
  await picker.getByRole("button", { name: /^Cat 4 US landfall/ }).click();
  await expect(added).toBeVisible();
  await expect.poll(async () => (await api<RoomDTO>(page, `rooms/${slug}`)).watchlist).toEqual(["cpi-oct", "hurricane"]);
  await picker.getByRole("button", { name: /^Cat 4 US landfall/ }).click();
  await expect(added).toHaveCount(0);
  await expect.poll(async () => (await api<RoomDTO>(page, `rooms/${slug}`)).watchlist).toEqual(["cpi-oct"]);
  await page.keyboard.press("Escape");

  // 09.3: the owner sets the rules and holds the danger zone.
  await page.getByRole("button", { name: "Room settings" }).click();
  const manage = page.getByRole("dialog", { name: `Manage ${name}` });
  await manage.getByRole("tab", { name: "Rules" }).click();
  await manage.getByLabel("Room rules").fill("One thread per release.");
  await manage.getByRole("button", { name: "Save rules" }).click();
  await expect(manage.getByText("Saved")).toBeVisible();
  await expect.poll(async () => (await api<RoomDTO>(page, `rooms/${slug}`)).rules).toBe("One thread per release.");
  await manage.getByRole("button", { name: "Archive room" }).click();
  await manage.getByRole("button", { name: "Archive room" }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  // Archived: gone from the directory; its address still says what it was.
  await expect
    .poll(async () => (await api<{ items: { id: string }[] }>(page, "rooms?limit=100")).items.map((r) => r.id))
    .not.toContain(slug);
  expect(await api<{ archived: boolean }>(page, `rooms/${slug}`)).toMatchObject({ archived: true });
});

test("an invite-only room shows outsiders a cover and takes a request", async ({ page, browser }) => {
  await newTrader(page, "Iris Owner");
  const name = `Box Seats ${tag()}`;
  const slug = await roomOf(page, name, "Invite only", ["film"]);
  const guest = await secondTrader(browser, "Gil Guest");
  try {
    await guest.page.goto(`/rooms/${slug}`);
    await expect(guest.page.getByText(`${name} is invite only`)).toBeVisible();
    await expect(guest.page.getByRole("log")).toHaveCount(0);
    await expect(guest.page.getByRole("button", { name: "Room settings" })).toHaveCount(0);
    await guest.page.getByRole("button", { name: "Request to join" }).click();
    await expect(guest.page.getByRole("button", { name: "Request sent" })).toBeDisabled();
    await expect.poll(async () => (await api<{ requested: boolean }>(guest.page, `rooms/${slug}`)).requested).toBe(true);
  } finally {
    await guest.context.close();
  }
});

test("an invite-only room keeps its content back until the owner approves", async ({ page, browser }) => {
  await newTrader(page, "Iris Owner");
  const name = `Box Seats ${tag()}`;
  const slug = await roomOf(page, name, "Invite only", ["film"]);
  await api(page, `rooms/${slug}/channels/general/messages`, { data: { text: "Opening weekend thread." } });

  const guest = await secondTrader(browser, "Gil Guest");
  try {
    // An outsider gets the cover, not the conversation.
    expect(await api<{ locked: boolean }>(guest.page, `rooms/${slug}`)).toMatchObject({ locked: true });
    const closed = await guest.page.request.get(`/api/v1/rooms/${slug}/channels/general/messages?limit=10`);
    expect(closed.ok()).toBe(false);
    // Asked through the API while the cover can't render (see above).
    await api(guest.page, `rooms/${slug}/requests`, { method: "POST" });

    // The owner sees the request and approves it.
    await page.goto(`/rooms/${slug}`);
    await page.getByRole("button", { name: "Room settings" }).click();
    const manage = page.getByRole("dialog", { name: `Manage ${name}` });
    await manage.getByRole("tab", { name: "Requests · 1" }).click();
    await expect(manage.getByText("Gil Guest")).toBeVisible();
    await manage.getByRole("button", { name: "Approve" }).click();
    await expect(manage.getByText("No one is waiting to join.")).toBeVisible();
    await expect
      .poll(async () => (await api<RoomDTO>(page, `rooms/${slug}`)).members.map((m) => m.handle))
      .toContain(guest.handle);

    // The guest is told, and is in.
    await expect
      .poll(async () => (await api<{ items: { title: string }[] }>(guest.page, "notifications")).items.map((n) => n.title))
      .toContain(`You're in: ${name}`);
    await guest.page.goto(`/rooms/${slug}`);
    await expect(guest.page.getByLabel("Message #general")).toBeEnabled();
    await expect(guest.page.getByRole("log", { name: "Messages in #general" })).toContainText("Opening weekend thread.");
  } finally {
    await guest.context.close();
  }
});

test("a message reaches another member live, without a reload", async ({ page, browser }) => {
  await newTrader(page, "Lena Live");
  const slug = await roomOf(page, `Live Wire ${tag()}`, "Public");
  const peer = await secondTrader(browser, "Pip Peer");
  try {
    await join(peer.page, slug);
    // Each side listening on the room's channel before anyone speaks.
    const listening = (p: Page) =>
      p.waitForResponse((r) => r.url().includes("/api/v1/stream") && decodeURIComponent(r.url()).includes("room:"));
    const [a, b] = [listening(page), listening(peer.page)];
    await page.goto(`/rooms/${slug}?channel=general`);
    await peer.page.goto(`/rooms/${slug}?channel=general`);
    await Promise.all([a, b]);
    const hello = `First light (${tag()})`;
    await page.getByLabel("Message #general").fill(hello);
    await page.getByLabel("Message #general").press("Enter");
    const peerLog = peer.page.getByRole("log", { name: "Messages in #general" });
    await expect(peerLog.getByRole("article").filter({ hasText: hello })).toBeVisible({ timeout: 15_000 });
    // And back the other way.
    const answer = `Heard you (${tag()})`;
    await peer.page.getByLabel("Message #general").fill(answer);
    await peer.page.getByLabel("Message #general").press("Enter");
    await expect(
      page.getByRole("log", { name: "Messages in #general" }).getByRole("article").filter({ hasText: answer }),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await peer.context.close();
  }
});
