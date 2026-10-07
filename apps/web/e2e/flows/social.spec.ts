import type { Page } from "@playwright/test";
import { api, expect, HANDLES, newTrader, postBy, secondTrader, test } from "../support";

test.use({ viewport: { width: 1440, height: 1000 } });

interface PostView {
  id: string;
  marketId: string;
  outcome: string;
  confidence: string;
  likes: number;
  commentCount: number;
  author: { handle: string };
}

/** A prediction straight through the API, for tests about what follows it. */
const predict = (page: Page, text: string) =>
  api<PostView>(page, "posts", {
    data: { market: "fed-dec", outcome: "Yes", text, confidence: "Medium", clientId: crypto.randomUUID() },
  });

/** The topbar's "+": the composer. */
const compose = (page: Page) => page.locator("header").first().getByRole("button", { name: "Share your take" }).click();

/** Follow from a profile's header. The pointer then leaves the button: while
    it rests there the visible label swaps to Unfollow. */
async function followFromProfile(page: Page) {
  const header = page.locator("main header");
  await header.getByRole("button", { name: "Follow", exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(header.getByRole("button", { name: "Following", exact: true })).toHaveAttribute("aria-pressed", "true");
}

/** The feed's filter row (the visible one of the two toggles), then Saved. */
async function toggleSaved(page: Page) {
  await page.getByRole("button", { name: "Filter predictions" }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Saved predictions", exact: true }).click();
}

test("a prediction, its like, bookmark and reply, and a follow persist", async ({ page }) => {
  const me = await newTrader(page, "Tess Take");
  await page.goto("/feed");
  await compose(page);
  const text = `My local thesis ${Date.now() % 10_000}: spot demand matters more than the headlines.`;
  await page.getByLabel("Reasoning", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Choose a market", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search existing markets" }).fill("Fed December");
  await page.getByRole("button", { name: /Will the Fed cut rates at the December/ }).click();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Prediction published")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  const post = page.locator(".feed-post").filter({ hasText: text });
  await expect(post).toBeVisible();
  await post.getByRole("button", { name: "Like prediction by Tess Take" }).click();
  await post.getByRole("button", { name: "Bookmark prediction" }).click();
  // Replies open the prediction's thread, where the reply box lives.
  await post.getByRole("link", { name: /replies$/ }).click();
  await expect(page).toHaveURL(/\/post\/.+#replies$/);
  const id = page.url().match(/\/post\/([^#?]+)/)![1]!;
  await page.getByLabel("Reply to Tess Take").fill("I am watching the next data release.");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("I am watching the next data release.");

  // All of it is the server's now.
  await expect
    .poll(async () => {
      const saved = await api<PostView>(page, `posts/${id}`);
      return [saved.likes, saved.commentCount, saved.author.handle];
    })
    .toEqual([1, 1, me.handle]);
  const bookmarks = await api<{ items: { id: string }[] }>(page, "posts?feed=bookmarks&limit=50");
  expect(bookmarks.items.map((p) => p.id)).toEqual([id]);

  // The feed shows the reply under the prediction; Saved narrows to it.
  await page.goto("/feed");
  await expect(page.locator(".feed-post").filter({ hasText: text })).toContainText("I am watching the next data release.");
  await toggleSaved(page);
  await expect(page.locator(".feed-post")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".feed-post")).toHaveCount(1);
  await expect(page.locator(".feed-post").first()).toContainText(text);

  // Follow from a profile; its record answers per period.
  await page.goto(`/trader/${HANDLES.ren}`);
  await followFromProfile(page);
  await expect
    .poll(async () => (await api<{ items: { handle: string }[] }>(page, "me/following")).items.map((t) => t.handle))
    .toContain(HANDLES.ren);
  await page.getByRole("button", { name: "90D", exact: true }).click();
  await expect(page.getByText(/of \d+ resolved/).first()).toBeVisible();
  await page.goto(`/trader/${HANDLES.mira}`);
  await expect(page.getByText("Resolved Yes").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /cumulative profit and loss over 30D/ })).toBeVisible();
});

test("following narrows the feed, and saved narrows whichever view you're in", async ({ page }) => {
  await newTrader(page, "Finn Follows");
  // One bookmark from someone you won't follow, from For you.
  const luis = await postBy(page, HANDLES.luis);
  await api(page, `posts/${luis}/reactions/bookmark`, { method: "PUT" });

  await page.goto("/");
  await page.getByRole("button", { name: /^Following · 0$/ }).click();
  // 06.1: with the traders panel beside it, the empty state points left.
  await expect(page.getByText("You’re not following anyone yet")).toBeVisible();
  const followingUrl = page.url();

  await page.goto(`/trader/${HANDLES.mira}`);
  await followFromProfile(page);

  await page.goto(followingUrl);
  await expect(page.getByRole("button", { name: /^Following · 1$/ })).toHaveAttribute("aria-pressed", "true");
  const first = page.locator(".feed-post").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText("Mira Kaplan");
  await first.getByRole("button", { name: "Bookmark prediction" }).click();
  await toggleSaved(page);
  // Saved within Following: Mira's one.
  await expect(page.locator(".feed-post")).toHaveCount(1);
  await expect(page.locator(".feed-post").first()).toContainText("Mira Kaplan");
  // Saved within For you: both bookmarks.
  await page.getByRole("button", { name: "For you", exact: true }).click();
  await expect(page.locator(".feed-post")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".feed-post")).toHaveCount(2);
});

test("the composer needs a market and some text, then publishes a linked prediction", async ({ page }) => {
  const me = await newTrader(page, "Cole Composer");
  await page.goto("/feed");
  await compose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Post" })).toBeDisabled();
  // Text alone isn't enough: a prediction needs a market.
  await dialog.getByLabel("Reasoning", { exact: true }).fill("Short take.");
  await expect(dialog.getByRole("button", { name: "Post" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Choose a market", exact: true }).click();
  await dialog.getByRole("searchbox", { name: "Search existing markets" }).fill("Bitcoin");
  await dialog.getByRole("button", { name: /Will Bitcoin trade above/ }).click();
  await dialog.getByRole("button", { name: "No", exact: true }).click();
  await dialog
    .getByLabel("Reasoning", { exact: true })
    .fill("Network activity is fine but the calendar is tight for this one.");
  await dialog.getByRole("button", { name: "Prediction settings" }).click();
  await dialog.getByRole("button", { name: "High", exact: true }).click();
  await dialog.getByRole("button", { name: "Post" }).click();
  await expect(dialog.getByText("Prediction published")).toBeVisible();

  const mine = await api<{ items: PostView[] }>(page, `posts?trader=${me.handle}&limit=5`);
  expect(mine.items).toHaveLength(1);
  expect(mine.items[0]).toMatchObject({ marketId: "btc", outcome: "No", confidence: "High" });
  await dialog.getByRole("link", { name: "View prediction" }).click();
  await expect(page).toHaveURL(new RegExp(`/post/${mine.items[0]!.id}$`));
  await expect(page.getByText("Predicts No")).toBeVisible();
});

test("a follow and a reply reach the author live; filters and mark-read drive the badge", async ({ page, browser }) => {
  const author = await newTrader(page, "Ada Author");
  const post = await predict(page, "December is live: two voters moved dovish in the minutes, and services are cooling.");
  await page.goto("/notifications");
  const inbox = page.locator("section").filter({ has: page.getByRole("heading", { name: "Notifications", level: 1 }) });
  await expect(inbox.getByText("0 unread")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

  const bo = await secondTrader(browser, "Bo Follower");
  try {
    await api(bo.page, `traders/${author.handle}/follow`, { method: "PUT" });
    await api(bo.page, `posts/${post.id}/comments`, { data: { text: "Counterpoint: the dots matter more than the adjective." } });
  } finally {
    await bo.context.close();
  }

  // Delivered by the worker through the outbox, then realtime: no reload.
  await expect(page.getByRole("link", { name: "Bo Follower followed you" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Bo Follower replied to your prediction" })).toBeVisible({ timeout: 20_000 });
  await expect(inbox.getByText("2 unread")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 2 unread" })).toBeVisible();

  const filters = page.getByRole("group", { name: "Filter notifications" });
  await filters.getByRole("button", { name: "Social", exact: true }).click();
  await expect(inbox.getByRole("article")).toHaveCount(2);
  await filters.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(inbox.getByRole("article")).toHaveCount(0);
  await filters.getByRole("button", { name: "All", exact: true }).click();

  await inbox.getByRole("button", { name: "Mark read" }).first().click();
  await expect(inbox.getByText("1 unread")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications, 1 unread" })).toBeVisible();
  await inbox.getByRole("button", { name: "Mark all read" }).click();
  await expect(inbox.getByText("0 unread")).toBeVisible();
  await expect(inbox.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  await expect.poll(async () => (await api<{ unread: number }>(page, "notifications")).unread).toBe(0);
  await page.reload();
  await expect(inbox.getByText("0 unread")).toBeVisible();
});

test("a prediction shares by link and can be reported; your own can't", async ({ page, context }) => {
  await newTrader(page, "Rae Reporter");
  // Desktop Chrome would offer its share sheet; the link-copy path is the one
  // every browser has.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await postBy(page, HANDLES.luis);
  await page.goto(`/post/${id}`);

  await page.getByRole("button", { name: "Share prediction" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/post/${id}`, page.url()).href);

  await page.getByRole("button", { name: "Report prediction" }).click();
  const dialog = page.getByRole("dialog", { name: "Report this prediction" });
  const send = dialog.getByRole("button", { name: "Send report" });
  await expect(send).toBeDisabled();
  // "Something else" needs a word for the moderators.
  await dialog.getByText("Something else", { exact: true }).click();
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/Anything the moderators should know/).fill("Claims a position that isn't there.");
  await expect(send).toBeEnabled();
  await dialog.getByText("Misleading", { exact: true }).click();
  await send.click();
  const thanks = page.getByRole("dialog", { name: "Thanks — it’s with the moderators" });
  await expect(thanks).toBeVisible();
  await thanks.getByRole("button", { name: "Done" }).click();
  await expect(thanks).toHaveCount(0);

  const own = await predict(page, "My own call on December: the committee waits for one more print.");
  await page.goto(`/post/${own.id}`);
  await expect(page.getByRole("button", { name: "Share prediction" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Report prediction" })).toHaveCount(0);
});
