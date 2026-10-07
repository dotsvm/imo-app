import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { collectErrors, expect, HANDLES, newVisitor, test, WAITLIST_URL } from "../support";

const unique = (prefix: string) => `${prefix}_${Date.now().toString(36).slice(-6)}`;
const standing = async (page: Page) => (await page.request.get(`${WAITLIST_URL}/api/v1/waitlist/me`)).json();
async function noViolations(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(scan.violations.map((v) => v.id), "no accessibility violations").toEqual([]);
}
/** The claimed card's headline: "You’re on the list." (or "You’re in." once let in). */
const held = (page: Page) => page.getByRole("heading", { level: 2, name: /^You’re (on the list|in)\.$/ });

/** Claim through the stack's way in: an emailed link, signed in on the spot. */
async function claimByEmail(page: Page, handle: string) {
  await page.getByLabel("Choose your username").fill(handle);
  await expect(page.getByText(`@${handle} is available`)).toBeVisible();
  await page.getByRole("button", { name: "Claim with email" }).click();
  await page.getByLabel("Your email").fill(`${handle}@example.com`);
  await page.getByRole("button", { name: "Email me a link" }).click();
}

test("the waitlist app: a username printed on a founding pass, held once you sign in", async ({ page }) => {
  const handle = unique("claim");
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(WAITLIST_URL);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your name");
  const field = page.getByLabel("Choose your username");
  // The test stack signs in by email only: that's the way in it offers.
  const go = page.getByRole("button", { name: "Claim with email" });
  await expect(field).toBeVisible();
  await expect(go).toBeVisible();
  await noViolations(page);

  // Taken, reserved, malformed: said plainly, and nothing to continue with.
  await field.fill(HANDLES.mira);
  await expect(page.getByText(`@${HANDLES.mira} is taken`)).toBeVisible();
  await expect(go).toBeDisabled();
  await field.fill("support");
  await expect(page.getByText("@support is reserved")).toBeVisible();
  await field.fill("x");
  await expect(page.getByText("Use 2–24 letters, numbers or underscores")).toBeVisible();

  // Typed in capitals, held in lowercase — and printed on the pass as you go.
  await field.fill(handle.toUpperCase());
  await expect(field).toHaveValue(handle);
  await expect(page.getByText(`@${handle} is available`)).toBeVisible();
  await expect(page.getByRole("img", { name: new RegExp(`pass for @${handle}, Classic edition`) })).toBeVisible();
  await page.getByRole("radio", { name: "Crypto edition" }).first().check({ force: true });
  await expect(page.getByRole("img", { name: new RegExp(`pass for @${handle}, Crypto edition`) })).toBeVisible();

  await go.click();
  await page.getByLabel("Your email").fill(`${handle}@example.com`);
  await page.getByRole("button", { name: "Email me a link" }).click();

  // The claim says what it's doing as it does it; then the pass is yours, in
  // the edition you picked, numbered in the order people joined.
  await expect(page.getByRole("status")).toContainText(`Holding @${handle}`);
  await expect(held(page)).toBeVisible();
  const status = await standing(page);
  expect(status).toMatchObject({ handle, edition: "crypto", shared: false });
  expect(status.pass).toBeGreaterThan(0);
  // The test stack lets everyone in, so the card says so; the pass carries its number.
  await expect(held(page)).toHaveText("You’re in.");
  await expect(page.getByRole("img", { name: new RegExp(`number ${status.pass}$`) })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(`@${handle} is yours, on the record.`);
  // Your link, to copy or share.
  await expect(page.getByText(new RegExp(`/i/${handle}$`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy your link" })).toBeVisible();
  await noViolations(page);

  // Coming back later shows the same pass; the app is a link away.
  await page.reload();
  await expect(held(page)).toBeVisible();
  await expect(page.getByRole("img", { name: new RegExp(`Crypto edition, number ${status.pass}`) })).toBeVisible();
  // The waitlist stands on its own for now: no way into the app from here.
  await expect(page.getByRole("link", { name: /Explore markets|Open imo/ })).toHaveCount(0);
  expect(errors.filter((e) => !e.startsWith("Failed to load resource"))).toEqual([]);
});

test("your link: friends who claim through it count, and posting your pass opens X with it", async ({ page, browser }) => {
  const holder = unique("holder");
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // X's composer opens in a window of its own: note where instead.
  await page.addInitScript(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = ((url?: string | URL) => {
      w.opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto(WAITLIST_URL);
  await claimByEmail(page, holder);
  await expect(held(page)).toBeVisible();

  // A friend opens the link: it says whose it is, and they claim through it.
  const friend = await newVisitor(browser);
  const mate = unique("friend");
  await friend.page.emulateMedia({ reducedMotion: "reduce" });
  await friend.page.goto(`${WAITLIST_URL}/i/${holder}`);
  await expect(friend.page.getByText(`@${holder} invited you`)).toBeVisible();
  await claimByEmail(friend.page, mate);
  await expect(held(friend.page)).toBeVisible();
  await friend.context.close();
  const before = await standing(page);
  expect(before).toMatchObject({ referrals: 1, opens: 1, shared: false });

  // Share: the post is drafted with your link, in the tone you pick.
  await page.getByRole("button", { name: "Share on X" }).click();
  const composer = page.getByRole("dialog", { name: "Share your pass" });
  await expect(composer).toBeVisible();
  const post = composer.getByLabel("Post text");
  await expect(post).toHaveValue(new RegExp(`^Claimed my name on imo\\.[\\s\\S]*/i/${holder}$`));
  // The card itself, to attach or keep: the same image X unfurls the link into.
  await expect(composer.getByRole("button", { name: "Copy image" })).toBeVisible();
  const save = composer.getByRole("link", { name: "Download" });
  await expect(save).toHaveAttribute("href", `/i/${holder}/opengraph-image`);
  await expect(save).toHaveAttribute("download", `imo-pass-${holder}.png`);
  await composer.getByRole("radio", { name: "Low-key" }).check();
  await expect(post).toHaveValue(new RegExp(`^got my imo pass\\. #[\\d,]+\\n\\S+/i/${holder}$`));
  await noViolations(page);

  // Posting opens X's composer with it, and moves you up the line — once.
  await composer.getByRole("button", { name: "Post to X" }).click();
  await expect(composer).toBeHidden();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
  expect(decodeURIComponent(opened[0])).toContain(`got my imo pass. #`);
  expect(await standing(page)).toMatchObject({ shared: true, boost: before.boost + 10 });
  await expect(page.getByRole("button", { name: "Post again on X" })).toBeVisible();

  // The link unfurls into the holder's own pass; their own visits aren't counted.
  await page.goto(`${WAITLIST_URL}/i/${holder}`);
  await expect(held(page)).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `@${holder} is on the record — imo`);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  const card = await page.locator('meta[name="twitter:image"]').getAttribute("content");
  expect(og).toContain(`/i/${holder}/opengraph-image`);
  expect(card).toContain(`/i/${holder}/twitter-image`);
  const image = await page.request.get(og!);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect((await standing(page)).opens).toBe(1);
  expect(errors.filter((e) => !e.startsWith("Failed to load resource"))).toEqual([]);
});
