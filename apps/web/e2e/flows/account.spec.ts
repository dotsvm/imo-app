/**
 * Signing in is a dialog over the app, never a page: the feed and everything
 * public stay readable signed out, and taking part asks you to log in where
 * you are. (The e2e stack has no Supabase, so the dialog offers the demo
 * trader and dev email sign-in; Google and wallets need a real project.)
 */
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, me, newTrader, test } from "../support";

/** What the Sign out button leaves behind, so the demo stays signed out. */
const SIGNED_OUT = "hunch.signedOut";

/** Start signed out, the way a signed-out browser arrives. */
const arriveSignedOut = (page: Page) =>
  page.addInitScript((key) => window.localStorage.setItem(key, "1"), SIGNED_OUT);

/** Is anyone signed in on this page's context? */
const sessionStatus = async (page: Page) => (await page.request.get("/api/v1/me")).status();

const signInDialog = (page: Page) => page.getByRole("dialog", { name: "Log in or sign up" });

test("signed out, the feed stays open to read and private pages say what they're for", async ({ page }) => {
  await newTrader(page, "Sid Signout");
  await page.goto("/settings");
  await expect(page.getByText(/^Signed in with/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(await sessionStatus(page)).toBe(401);

  // The home feed, as anyone sees it, with the way in at the top.
  await expect(page.locator(".feed-post").first()).toBeVisible();
  const header = page.locator("header").first();
  await expect(header.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();

  // The demo doesn't sign itself back in after you signed out here.
  await page.reload();
  await expect(page.locator(".feed-post").first()).toBeVisible();
  expect(await sessionStatus(page)).toBe(401);

  // A page that's yours alone asks you to log in, in place.
  await page.goto("/portfolio");
  await expect(page.getByText("Your portfolio lives here")).toBeVisible();
  await page.getByRole("button", { name: "Log in or sign up" }).click();
  await expect(signInDialog(page)).toBeVisible();
  await expect(page).toHaveURL(/\/portfolio$/);
});

test("taking part while signed out asks to log in; the demo trader picks up there", async ({ page }) => {
  await arriveSignedOut(page);
  await page.goto("/");
  const post = page.locator(".feed-post").first();
  await expect(post).toBeVisible();
  const likesBefore = await post.getByRole("button", { name: /^Like prediction/ }).innerText();
  await post.getByRole("button", { name: /^Like prediction/ }).click();
  await expect(signInDialog(page)).toBeVisible();
  // Nothing was applied on the way.
  await page.keyboard.press("Escape");
  await expect(signInDialog(page)).toHaveCount(0);
  await expect(post.getByRole("button", { name: /^Like prediction/ })).toHaveText(likesBefore);

  await page.getByRole("button", { name: "Log in", exact: true }).first().click();
  await signInDialog(page).getByRole("button", { name: "Continue as the demo trader" }).click();
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  expect((await me(page)).user.handle).toBe("jordan");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a new address signs up in the dialog, picks a handle and stays on the page", async ({ page }) => {
  await arriveSignedOut(page);
  await page.goto("/leaderboard");
  await page.getByRole("button", { name: "Sign up", exact: true }).first().click();
  const dialog = signInDialog(page);
  const email = `e2e-${Date.now().toString(36)}@example.com`;
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: /Start with this email/ }).click();

  // Signed in, on the same page: a new account picks its handle.
  const welcome = page.getByRole("dialog", { name: "Welcome to imo" });
  await expect(welcome).toBeVisible();
  await expect(page).toHaveURL(/\/leaderboard$/);
  const fresh = await me(page);
  expect(fresh.settings.onboarded).toBe(false);
  expect(fresh.account.cashCents).toBe(1_000_000);
  // It starts on an illustration, and can wear another before going on.
  expect(fresh.user.avatarUrl).toMatch(/^\/avatars\/lorelei-\d{2}\.svg$/);
  await welcome.getByRole("button", { name: "Illustration 3" }).click();
  await expect(welcome.getByRole("button", { name: "Illustration 3" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await me(page)).user.avatarUrl).toBe("/avatars/lorelei-03.svg");
  const handle = `e2e${Date.now().toString(36).slice(-6)}`;
  await welcome.getByRole("textbox", { name: "Handle" }).fill(`@${handle}`);
  await welcome.getByRole("button", { name: /^Continue/ }).click();
  await expect(welcome).toHaveCount(0);
  const done = await me(page);
  expect(done.settings.onboarded).toBe(true);
  expect(done.user.handle).toBe(handle);

  // Once: back again, no welcome.
  await page.reload();
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("links to sign in open the dialog: old welcome links, and a link that expired", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await arriveSignedOut(page);
  await page.goto("/welcome?invite=ABCD-EFGH");
  await expect(page).toHaveURL(/\/\?invite=ABCD-EFGH$/);
  await expect(signInDialog(page)).toBeVisible();

  await page.goto("/?signin=expired");
  await expect(signInDialog(page).getByRole("alert")).toContainText("That sign-in link has expired");
  await expect(page).toHaveURL(/\/$/);
  // The dialog itself: the page behind sits under its dimming overlay.
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("signed out, a ticket prices your trade and asks you to log in to place it", async ({ page }) => {
  await arriveSignedOut(page);
  await page.goto("/market/fed-dec");
  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await ticket.getByLabel("Amount (USD)").fill("100");
  // The design's $100 ticket, priced for anyone: 153 shares, $99.37 all in.
  await expect(ticket).toContainText("$99.37");
  await expect(ticket).not.toContainText("Insufficient balance");
  await ticket.getByRole("button", { name: "Log in to trade" }).click();
  await expect(signInDialog(page)).toContainText("Log in to trade with your paper balance.");
});
