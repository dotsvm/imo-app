import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { api, buy, expect, me, newTrader, place, positionOn, review, test } from "../support";

/* Trading on the paper engine, as a fresh $10,000 trader each time: the
   server prices every ticket from the design's books and the worker runs
   behind it, exactly as a deployment does. */

interface QuoteDTO {
  shares: number;
  priceCents: number;
  totalCents: number;
  complete: boolean;
}
interface OrderDTO {
  id: string;
  status: string;
  filledShares: number;
  resting?: boolean;
  filledTotalCents?: number;
  quote: { marketId: string; side: string; outcome: string; shares: number; priceCents: number };
}

const START = 1_000_000;
const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the server would charge for a ticket, before the UI shows it. */
const quote = (page: Page, body: Record<string, unknown>) =>
  api<QuoteDTO>(page, "quotes", { data: { market: "fed-dec", side: "Buy", outcome: "Yes", ...body } });
const orders = (page: Page) => api<{ items: OrderDTO[] }>(page, "orders").then((r) => r.items);
const ticketOn = async (page: Page, market = "fed-dec") => {
  await page.goto(`/market/${market}`);
  const ticket = page.getByRole("region", { name: "Trade ticket" });
  await expect(ticket).toBeVisible();
  return ticket;
};
const amountOf = (ticket: Locator) => ticket.getByLabel("Amount (USD)");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("a buy is priced by the server, fills, survives a reload, and part of it sells", async ({ page }) => {
  await newTrader(page, "Bea Buyer");
  // 04.1's ticket: $100 of Yes on fed-dec is 153 shares at 63¢, $99.37 all in.
  const priced = await quote(page, { amountCents: 10_000 });
  expect(priced).toMatchObject({ shares: 153, priceCents: 63, totalCents: 9_937, complete: true });

  const ticket = await ticketOn(page);
  await amountOf(ticket).fill("100");
  await expect(ticket).toContainText("$99.37");
  await expect(ticket).toContainText("64.9¢"); // average incl. fees, 99.37 / 153
  await review(ticket);
  await expect(ticket.getByRole("heading", { name: "Buy 153 Yes at 63¢" })).toBeFocused();
  await place(ticket);
  await expect(ticket.getByRole("heading", { name: "Order filled" })).toBeVisible();
  await expect(ticket).toContainText("Bought 153 Yes at 63¢ · total $99.37 incl. fees.");
  await expect(ticket).toContainText("153 Yes"); // the new position row, once the portfolio reloads

  expect((await positionOn(page, "fed-dec", "Yes")).shares).toBe(153);
  expect((await me(page)).account.cashCents).toBe(START - 9_937);

  // A reload starts a fresh ticket; the server still has the fill.
  await page.reload();
  await expect(ticket.getByRole("button", { name: /Slide to review order/ })).toBeVisible();
  expect((await me(page)).account.cashCents).toBe(START - 9_937);

  // Sell part: the ticket opens on what you hold.
  const sale = await quote(page, { side: "Sell", shares: 10 });
  await ticket.getByRole("group", { name: "Order side" }).getByRole("button", { name: "Sell" }).click();
  const shares = ticket.getByLabel("Shares to sell");
  await expect(shares).toHaveValue("153");
  await shares.fill("10");
  await expect(ticket).toContainText(usd(sale.totalCents));
  await review(ticket);
  await expect(ticket.getByRole("heading", { name: `Sell 10 Yes at ${sale.priceCents}¢` })).toBeFocused();
  await place(ticket);
  await expect(ticket.getByRole("heading", { name: "Order filled" })).toBeVisible();
  await expect(ticket).toContainText(`Sold 10 Yes at ${sale.priceCents}¢ · net ${usd(sale.totalCents)}.`);

  expect((await positionOn(page, "fed-dec", "Yes")).shares).toBe(143);
  expect((await me(page)).account.cashCents).toBe(START - 9_937 + sale.totalCents);

  // Both trades are on the activity rail, in the server's words.
  await page.goto("/portfolio");
  const activity = page.getByRole("complementary", { name: "Activity" });
  await expect(activity).toContainText("Bought Yes · Fed cuts in December");
  await expect(activity).toContainText("Sold Yes · Fed cuts in December");
});

test("amounts the ticket can't take are stopped before review", async ({ page }) => {
  await newTrader(page, "Ivy Invalid");
  const ticket = await ticketOn(page);
  const amount = amountOf(ticket);

  // 05.5: the server's minimum, as you type.
  await amount.fill("0.40");
  await expect(ticket).toContainText("Minimum order is $1.00.");
  await expect(ticket.getByRole("button", { name: "Fix the amount to continue" })).toBeDisabled();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  // Not a number at all: answered in the browser, before any request.
  await amount.fill("abc");
  await expect(ticket).toContainText("Enter an amount of at least $1.00.");
  await expect(ticket.getByRole("button", { name: "Fix the amount to continue" })).toBeDisabled();

  // Selling what you don't hold is stopped before review, on either side.
  await ticket.getByRole("group", { name: "Order side" }).getByRole("button", { name: "Sell" }).click();
  await expect(ticket).toContainText("You don’t hold Yes shares in this market.");
  await expect(ticket.getByRole("button", { name: "Nothing to sell" })).toBeDisabled();
  await ticket.getByRole("group", { name: "Outcome" }).getByRole("button", { name: /^No/ }).click();
  await expect(ticket).toContainText("You don’t hold No shares in this market.");

  // Holding some, you can't sell more than that.
  expect((await buy(page, "fed-dec", "Yes", 10_000)).filledShares).toBe(153);
  await page.reload();
  await ticket.getByRole("group", { name: "Order side" }).getByRole("button", { name: "Sell" }).click();
  await expect(ticket.getByLabel("Shares to sell")).toHaveValue("153");
  await ticket.getByLabel("Shares to sell").fill("240");
  await expect(ticket).toContainText("You hold 153 Yes shares.");
  await expect(ticket.getByRole("button", { name: "Fix the amount to continue" })).toBeDisabled();

  // Nothing here moved money.
  expect((await me(page)).account.cashCents).toBe(START - 9_937);
});

test("an amount over what you have says so, and Use max fits it", async ({ page }) => {
  await newTrader(page, "Max Spender");
  // Spend most of the balance first, so the quote itself runs past it. (No
  // design book quotes past a fresh $10,000 within the 2¢ limit.)
  await buy(page, "jobs-oct", "No", 500_000);
  await buy(page, "hottest-year", "No", 200_000);
  const { availableCents } = (await me(page)).account;
  expect(availableCents).toBeLessThan(310_000);

  const ticket = await ticketOn(page);
  const amount = amountOf(ticket);
  // $5,000 on fed-dec quotes $3,975.21 within the limit: more than what's left.
  await amount.fill("5000");
  await expect(ticket).toContainText(`Insufficient balance. You have ${usd(availableCents)} available.`);
  await expect(ticket.getByRole("button", { name: "Fix the amount to continue" })).toBeDisabled();
  await ticket.getByRole("button", { name: `Use max ${usd(availableCents)}` }).click();
  await expect(amount).toHaveValue((availableCents / 100).toFixed(2));
  await expect(amount).not.toHaveAttribute("aria-invalid", "true");
  await expect(ticket.getByRole("button", { name: /Slide to review order/ })).toBeEnabled();
});

test("an amount over your balance is refused before review, whatever the book's depth", async ({ page }) => {
  // The quote stops at the 2¢ slippage limit ($3,975.21 on fed-dec), but the
  // amount asked is what's held to the balance — by the server and the ticket.
  await newTrader(page, "Ola Overdraw");
  const ticket = await ticketOn(page);
  await amountOf(ticket).fill("12000");
  await expect(ticket).toContainText("Insufficient balance. You have $10,000.00 available.");
  await expect(ticket.getByRole("button", { name: "Use max $10,000.00" })).toBeVisible();
});

test("a limit below the ask rests, holds its cash, and cancels from the portfolio", async ({ page }) => {
  await newTrader(page, "Lin Limit");
  // 40¢ can't cross fed-dec's 63¢ ask, so it rests for as long as we look.
  const resting = await quote(page, { type: "limit", limitCents: 40, amountCents: 10_000 });
  expect(resting).toMatchObject({ shares: 238, priceCents: 40, totalCents: 9_968 });

  const ticket = await ticketOn(page);
  await ticket.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Limit" }).click();
  await ticket.getByLabel("Limit price").fill("40");
  await amountOf(ticket).fill("100");
  await expect(ticket).toContainText(usd(resting.totalCents));
  await review(ticket);
  await expect(ticket.getByRole("heading", { name: `Buy ${resting.shares} Yes · limit 40¢` })).toBeFocused();
  await place(ticket);
  await expect(ticket.getByRole("heading", { name: "Order pending" })).toBeVisible();
  await expect(ticket).toContainText("Resting on the book");
  // (What it holds, as the ticket words it: the next test.)

  const [order] = (await orders(page)).filter((o) => o.status === "pending");
  expect(order).toMatchObject({ resting: true, filledShares: 0 });
  const held = (await me(page)).account;
  expect(held.cashCents).toBe(START);
  expect(held.reservedCents).toBe(resting.totalCents);
  expect(held.availableCents).toBe(START - resting.totalCents);

  // 11.1: Pending orders list it with what it reserves, and Cancel frees it.
  await page.goto("/portfolio?tab=Pending%20orders");
  await expect(page.getByText(`${usd(resting.totalCents)} reserved from cash`)).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Order cancelled. Reserved funds or shares have been released.")).toBeVisible();
  await expect.poll(async () => (await me(page)).account.reservedCents).toBe(0);
  expect((await orders(page)).find((o) => o.id === order.id)?.status).toBe("cancelled");
  expect((await me(page)).account.availableCents).toBe(START);
});

test("a resting limit shows its size, limit and hold", async ({ page }) => {
  // The order's quote is its whole plan — what crosses now and the rest at
  // the limit — even when nothing has crossed yet.
  await newTrader(page, "Lu Limit");
  const ticket = await ticketOn(page);
  await ticket.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Limit" }).click();
  await ticket.getByLabel("Limit price").fill("40");
  await amountOf(ticket).fill("100");
  await expect(ticket).toContainText("$99.68");
  await review(ticket);
  await place(ticket);
  await expect(ticket).toContainText("Buy 238 Yes · Fed cuts in December · limit 40¢");
  await expect(ticket).toContainText("$99.68 is held until it fills.");
  await page.goto("/portfolio?tab=Pending%20orders");
  await expect(page.getByText("Limit 40¢")).toBeVisible();
  await expect(page.getByText("0 / 238")).toBeVisible();
});

test("a market buy past the book's 2¢ depth fills what it can and says so", async ({ page }) => {
  await newTrader(page, "Pat Partial");
  const capped = await quote(page, { amountCents: 500_000 });
  expect(capped.complete).toBe(false);

  const ticket = await ticketOn(page);
  await amountOf(ticket).fill("5000");
  await expect(ticket).toContainText(usd(capped.totalCents));
  await review(ticket);
  await expect(
    ticket.getByRole("heading", { name: new RegExp(`^Buy ${capped.shares.toLocaleString("en-US")} Yes at `) }),
  ).toBeFocused();
  await place(ticket);
  await expect(ticket.getByRole("heading", { name: "Partially filled" })).toBeVisible();
  await expect(ticket).toContainText(
    `${capped.shares.toLocaleString("en-US")} filled; the rest wasn’t available within 2¢ of the best price, so nothing more was spent.`,
  );
  // Only the rest is released: no Cancel for an order that isn't resting.
  await expect(ticket.getByRole("button", { name: "Cancel rest" })).toHaveCount(0);

  const [order] = await orders(page);
  expect(order).toMatchObject({ status: "partial", resting: false, filledShares: capped.shares });
  expect((await me(page)).account.cashCents).toBe(START - capped.totalCents);
});

test("an average price across book levels shows to a tenth of a cent", async ({ page }) => {
  // The raw average is 64.2698¢; every line rounds it the way the ledger does.
  await newTrader(page, "Ria Rounding");
  const ticket = await ticketOn(page);
  await amountOf(ticket).fill("5000");
  await expect(ticket).toContainText("$3,975.21");
  await review(ticket);
  await expect(ticket.getByRole("heading", { name: "Buy 6,005 Yes at 64.3¢" })).toBeVisible();
});

test("a price that moved past review asks again, and accepting fills", async ({ page }) => {
  await newTrader(page, "Mo Moved");
  const ticket = await ticketOn(page);
  await amountOf(ticket).fill("100");
  await expect(ticket).toContainText("$99.37");
  await review(ticket);

  // The design's books hold still, so make this review stale on its way out:
  // the server sees a confirmed price 5¢ off and refuses with price_moved.
  let sent = 0;
  await page.route("**/api/v1/orders", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    sent += 1;
    if (sent > 1) return route.continue();
    const body = { ...(request.postDataJSON() as Record<string, unknown>), expectedPriceCents: 58 };
    return route.continue({ postData: JSON.stringify(body) });
  });
  await place(ticket);
  // 05.6: past the limit the order asks again rather than filling.
  const moved = ticket.getByRole("alert");
  await expect(moved).toContainText("Price moved to 63¢");
  await expect(ticket.getByRole("heading", { name: "Order filled" })).toHaveCount(0);
  expect(await orders(page)).toHaveLength(0);

  await ticket.getByRole("button", { name: "Accept 63¢" }).click();
  await expect(ticket.getByRole("heading", { name: "Order filled" })).toBeVisible();
  expect(sent).toBe(2);
  expect((await positionOn(page, "fed-dec", "Yes")).shares).toBe(153);
  expect((await me(page)).account.cashCents).toBe(START - 9_937);
});

test("on a phone the order places only when held (05.2)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await newTrader(page, "Hal Hold");
  const small = await quote(page, { amountCents: 2_500 });
  await page.goto("/market/fed-dec");
  // 04.2: Buy Yes / Buy No sit at the thumb.
  const trigger = page.getByRole("button", { name: /^Buy Yes 63¢/ });
  await expect(trigger).toBeInViewport();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Buy · Fed cuts in December" })).toBeVisible();
  await dialog.getByLabel("Amount", { exact: true }).fill("25");
  await expect(dialog).toContainText(usd(small.totalCents));
  await review(dialog);
  await expect(dialog.getByText(`Buy ${small.shares} Yes at 63¢`)).toBeVisible();

  const hold = dialog.getByRole("button", { name: /^Place order/ });
  // A quick tap doesn't place it…
  await hold.click();
  await expect(hold).toBeVisible();
  expect(await orders(page)).toHaveLength(0);
  // …holding does.
  await hold.click({ delay: 900 });
  await expect(dialog.getByRole("heading", { name: "Order filled" })).toBeVisible();
  expect((await me(page)).account.cashCents).toBe(START - small.totalCents);
});

test("back and fade review their own outcomes, validate, and execute from home", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await newTrader(page, "Fay Fader");
  await page.goto("/");
  // Luis Prado's call on fed-dec: "the Fed keeps rates unchanged" — No.
  const post = page.locator(".feed-post").filter({ hasText: "Luis Prado" }).first();
  const back = post.getByRole("button", { name: /^Back / });
  await expect(back).toHaveText(/^Back No/);
  await back.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("net of fees");
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Back Luis · No");
  const outcomes = dialog.getByRole("group", { name: "Outcome" });
  await expect(outcomes.locator('button[aria-pressed="true"]')).toContainText("No");
  await page.keyboard.press("Escape");
  await expect(back).toBeFocused();

  // Fade is the other side, in its own review.
  await post.getByRole("button", { name: /^Fade / }).click();
  await expect(outcomes.locator('button[aria-pressed="true"]')).toContainText("Yes");
  const amount = dialog.getByLabel("Amount in dollars");
  await amount.fill("999999");
  await expect(dialog.getByRole("alert")).toContainText("Insufficient balance — $10,000.00 available.");
  await expect(dialog.getByRole("button", { name: "Fix amount to continue" })).toBeDisabled();
  await amount.fill("0.5");
  await expect(dialog.getByRole("alert")).toHaveText("Minimum order is $1.00.");
  const fifty = await quote(page, { amountCents: 5_000 });
  await amount.fill("50");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  // The server's price first: the drawer's slide isn't held back while it
  // loads, and a review before it arrives is silently ignored.
  await expect(dialog).toContainText(usd(fifty.totalCents));
  // The slide has a keyboard path: the knob is a button.
  await dialog.getByRole("button", { name: /^Slide to review order/ }).press("Enter");
  await expect(dialog.getByRole("heading", { name: `Buy ${fifty.shares} Yes at 63¢` })).toBeVisible();
  await dialog.getByRole("button", { name: "Place order" }).click();
  await expect(dialog.getByRole("heading", { name: "Order filled" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const [order] = await orders(page);
  expect(order).toMatchObject({ status: "filled", filledShares: fifty.shares });
  expect(order.quote).toMatchObject({ marketId: "fed-dec", outcome: "Yes", side: "Buy" });
  expect((await me(page)).account.cashCents).toBe(START - fifty.totalCents);

  // 06.3: phones review with a pinned button instead of the slide.
  await page.setViewportSize({ width: 375, height: 812 });
  await back.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review order" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});
