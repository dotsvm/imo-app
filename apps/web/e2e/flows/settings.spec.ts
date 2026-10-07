import { deflateSync } from "node:zlib";
import { api, buy, expect, me, newTrader, test } from "../support";

/** A small, real PNG (a colour gradient), for the photo upload. */
function png(width: number, height: number) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let x = 0xffffffff;
    for (const b of buf) x = table[(x ^ b) & 0xff]! ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set([40 + x, 160, 120 + y], y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("profile fields save when you leave them, a taken handle is refused and the photo uploads", async ({ page }) => {
  const trader = await newTrader(page, "Sasha Settings");
  // Everyone starts on one of the illustrations, served by the app itself.
  const given = (await me(page)).user.avatarUrl;
  expect(given).toMatch(/^\/avatars\/lorelei-\d{2}\.svg$/);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.locator(`img.av[src="${given}"]`).first()).toBeVisible();

  // Each field saves once, when you leave it — not on every key.
  const patches: string[] = [];
  page.on("request", (r) => r.method() === "PATCH" && r.url().endsWith("/api/v1/me") && patches.push(r.postData() ?? ""));
  const bio = `Macro first. Rates, then everything else. (${Date.now() % 1_000})`;
  await page.getByRole("textbox", { name: "Bio" }).fill(bio);
  await page.getByRole("textbox", { name: "Region" }).click();
  await expect(page.getByText("Bio saved.")).toBeVisible();
  expect(patches).toHaveLength(1);
  expect((await me(page)).user.bio).toBe(bio);

  await page.getByRole("textbox", { name: "Display name" }).fill("Sasha S.");
  await page.getByRole("textbox", { name: "Display name" }).press("Enter");
  await expect(page.getByText("Display name saved.")).toBeVisible();
  expect((await me(page)).user.displayName).toBe("Sasha S.");

  // Someone else's handle: refused beside the field, and the field goes back.
  const handle = page.getByRole("textbox", { name: "Handle" });
  await handle.fill("@hazelq");
  await handle.press("Enter");
  await expect(page.getByText("That handle is taken.").first()).toBeVisible();
  await expect(handle).toHaveValue(`@${trader.handle}`);
  expect((await me(page)).user.handle).toBe(trader.handle);

  // A photo goes straight to storage, then onto the profile.
  await page.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png(64, 64) });
  await expect(page.getByText("Photo updated.")).toBeVisible();
  const avatarUrl = (await me(page)).user.avatarUrl;
  expect(avatarUrl).toMatch(/\/avatars\/.+\.png$/);
  await expect(page.locator(`img.av[src="${avatarUrl}"]`).first()).toBeVisible();
  const served = await page.request.get(avatarUrl!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("Photo removed.")).toBeVisible();
  expect((await me(page)).user.avatarUrl).toBe(given);
  await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);

  // Or any other illustration: picked in the grid, shown everywhere.
  const pick = page.getByRole("button", { name: given === "/avatars/lorelei-07.svg" ? "Illustration 8" : "Illustration 7" });
  const wanted = given === "/avatars/lorelei-07.svg" ? "/avatars/lorelei-08.svg" : "/avatars/lorelei-07.svg";
  await pick.click();
  await expect(page.getByText("Avatar updated.")).toBeVisible();
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  expect((await me(page)).user.avatarUrl).toBe(wanted);
  await expect(page.locator(`img.av[src="${wanted}"]`).first()).toBeVisible();
  const drawn = await page.request.get(wanted);
  expect(drawn.status()).toBe(200);
  expect(drawn.headers()["content-type"]).toContain("image/svg+xml");
});

test("privacy takes you off the leaderboard", async ({ page }) => {
  const trader = await newTrader(page, "Priya Private");
  // Crypto is one of a new trader's interests: a short board, all on one page.
  await page.goto("/leaderboard?sample=off&category=Crypto");
  await expect(page.getByRole("rowheader", { name: /Priya Private/ })).toBeVisible();

  await page.goto("/settings#privacy");
  const appear = page.getByRole("switch", { name: "Appear on leaderboards" });
  await expect(appear).toHaveAttribute("aria-checked", "true");
  await appear.click();
  await expect(appear).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Appear on leaderboards off.")).toBeVisible();
  await expect
    .poll(async () => (await api<{ settings: { appearOnLeaderboard: boolean } }>(page, "me")).settings.appearOnLeaderboard)
    .toBe(false);

  await page.goto("/leaderboard?sample=off&category=Crypto");
  await expect(page.getByRole("rowheader").first()).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Priya Private/ })).toHaveCount(0);
  // The server leaves them off too, for everyone else's board.
  const board = await api<{ items: { trader: { handle: string } }[] }>(
    page,
    "leaderboard?period=30D&sample=off&category=Crypto&limit=100",
  );
  expect(board.items.map((i) => i.trader.handle)).not.toContain(trader.handle);
});

test("a new season needs RESET typed, then waits thirty days", async ({ page }) => {
  await newTrader(page, "Reese Reset");
  await buy(page, "fed-dec", "Yes", 5_000);
  expect((await api<{ positions: unknown[] }>(page, "portfolio")).positions).toHaveLength(1);

  await page.goto("/settings#demo");
  await page.getByRole("button", { name: "New season…" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new season?" });
  const start = dialog.getByRole("button", { name: "Start new season", exact: true });
  await expect(start).toBeDisabled();
  await dialog.getByLabel("Type RESET to confirm").fill("reset");
  await start.click();
  await expect(page.getByText("New season started. Your balance is back to $10,000.00.")).toBeVisible();
  const after = await me(page);
  expect(after.account.cashCents).toBe(1_000_000);
  expect((await api<{ positions: unknown[] }>(page, "portfolio")).positions).toHaveLength(0);

  // Once a season: the next reset is refused, and says when.
  await page.getByRole("button", { name: "New season…" }).click();
  await dialog.getByLabel("Type RESET to confirm").fill("RESET");
  await dialog.getByRole("button", { name: "Start new season", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("You can reset once every 30 days.");
});

test("notification preferences persist and the failure alert cannot be silenced", async ({ page }) => {
  await newTrader(page, "Nico Notify");
  await page.goto("/notifications");
  const digest = page.getByRole("switch", { name: "Traders you follow post — email" });
  await expect(digest).toHaveAttribute("aria-checked", "false");
  await digest.click();
  await expect(digest).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "Order failed — in-app" })).toBeDisabled();
  await expect
    .poll(async () => {
      const prefs = await api<{ items: { id: string; email: boolean }[] }>(page, "me/notification-preferences");
      return prefs.items.find((p) => p.id === "digest")?.email;
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Traders you follow post — email" })).toHaveAttribute("aria-checked", "true");
});

test("price alerts can be added and removed", async ({ page }) => {
  await newTrader(page, "Ava Alerts");
  await page.goto("/notifications");
  await expect(page.getByText("No alerts yet.")).toBeVisible();
  await page.getByLabel("Alert market").selectOption("btc");
  await page.getByLabel("Yes threshold in cents").fill("65");
  await page.getByRole("button", { name: "New alert" }).click();
  await expect(page.getByText("Yes crosses 65¢")).toBeVisible();
  await expect
    .poll(async () => (await api<{ items: { marketId: string; thresholdCents: number }[] }>(page, "alerts")).items)
    .toEqual([expect.objectContaining({ marketId: "btc", thresholdCents: 65 })]);
  await page.getByRole("button", { name: "Remove alert on BTC above $150K" }).click();
  await expect(page.getByText("No alerts yet.")).toBeVisible();
  await expect.poll(async () => (await api<{ items: unknown[] }>(page, "alerts")).items).toHaveLength(0);
});
