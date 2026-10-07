/**
 * The one flow that writes as the seeded viewer, so it runs last (files run
 * in name order): Jordan claims the design's settled payout.
 */
import { api, asSeededViewer, expect, test } from "../support";

interface Portfolio {
  account: { cashCents: number };
  claims: { positionId: string; marketId: string; payoutCents: number }[];
}

test("a settled position's payout is claimed to cash, once", async ({ page }) => {
  await asSeededViewer(page);
  const before = await api<Portfolio>(page, "portfolio");
  const claim = before.claims.find((c) => c.marketId === "jobs-sep");
  expect(claim, "the design's Sept payrolls payout is waiting").toBeTruthy();
  expect(claim!.payoutCents).toBe(20_000);

  await page.goto(`/position/${encodeURIComponent(claim!.positionId)}`);
  await expect(page.getByText("$200.00 ready to claim")).toBeVisible();
  await page.getByRole("button", { name: /^Claim \$200\.00 to cash/ }).click();
  await expect(page.getByRole("heading", { name: "$200.00 added to cash" })).toBeVisible();

  const after = await api<Portfolio>(page, "portfolio");
  expect(after.account.cashCents).toBe(before.account.cashCents + 20_000);
  expect(after.claims.some((c) => c.marketId === "jobs-sep")).toBe(false);

  // Claiming again is refused by the server, not merely hidden.
  const again = await page.request.post(`/api/v1/positions/${encodeURIComponent(claim!.positionId)}/claim`);
  expect(again.status()).toBe(409);

  await page.goto("/portfolio?tab=Activity");
  await expect(page.getByText("Claimed payout · Sept payrolls > 150K")).toBeVisible();
  await page.goto("/portfolio?tab=Claimable");
  await expect(page.getByRole("heading", { name: "All settled" })).toBeVisible();
});
