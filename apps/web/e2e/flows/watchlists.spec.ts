import type { Page } from "@playwright/test";
import { api, expect, newTrader, test } from "../support";

/* Watchlists as a fresh trader builds them. A new account has only "Saved
   markets", so each test makes its own lists through the API first, then
   works them through the UI and reads the result back from the server. */

interface List {
  id: string;
  name: string;
  isDefault: boolean;
  marketIds: string[];
}
const lists = (page: Page) => api<{ items: List[] }>(page, "watchlists").then((r) => r.items);
const listNamed = async (page: Page, name: string) => (await lists(page)).find((l) => l.name === name);

/** A named list holding `markets`, in that order. */
async function makeList(page: Page, name: string, markets: string[]) {
  const list = await api<List>(page, "watchlists", { data: { name, market: markets[0] } });
  for (const market of markets.slice(1)) await api(page, `watchlists/${list.id}/markets/${market}`, { method: "PUT", data: {} });
  return list.id;
}

const titles = new Map<string, { title: string; shortTitle: string }>();
/** A market's names, as the rows and buttons use them. */
async function named(page: Page, id: string) {
  if (!titles.has(id)) {
    const m = await api<{ title: string; shortTitle: string }>(page, `markets/${id}`);
    titles.set(id, { title: m.title, shortTitle: m.shortTitle });
  }
  return titles.get(id)!;
}

const RATES = ["fed-dec", "cpi-oct", "fed-nov", "inflation-dec", "jobs-oct"];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("named watchlists can be created, renamed, reordered, shared and deleted", async ({ page }) => {
  await newTrader(page, "Wes Watcher");
  const rates = await makeList(page, "Rates & inflation", RATES);
  const room = await api<{ id: string; name: string }>(page, "rooms", {
    data: { name: `Rates desk ${Date.now().toString(36)}`, privacy: "Invite only" },
  });
  const fed = await named(page, "fed-dec");
  const cpi = await named(page, "cpi-oct");

  await page.goto("/watchlist");
  await page.getByRole("link", { name: /^Rates & inflation/ }).click();
  await expect(page).toHaveURL(new RegExp(`list=${rates}`));
  await expect(page.getByRole("rowheader")).toHaveCount(5);

  // Rename in place.
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("List name").fill("Macro watch");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Macro watch/ })).toBeVisible();
  await expect.poll(async () => (await lists(page)).find((l) => l.id === rates)?.name).toBe("Macro watch");

  // Removing says so, and Undo puts the market back where it was.
  await page.getByRole("button", { name: `Remove ${fed.shortTitle} from Macro watch` }).click();
  await expect(page.getByRole("rowheader")).toHaveCount(4);
  await expect(page.getByText(`Removed ${fed.shortTitle} from Macro watch`)).toBeVisible();
  await expect.poll(async () => (await listNamed(page, "Macro watch"))?.marketIds).not.toContain("fed-dec");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("rowheader")).toHaveCount(5);
  await expect(page.getByRole("rowheader").first()).toContainText(fed.title);
  await expect.poll(async () => (await listNamed(page, "Macro watch"))?.marketIds).toEqual(RATES);

  // Edit list: a handle moves a market with the arrow keys, focus follows it.
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.getByRole("button", { name: `Reorder ${cpi.shortTitle}` }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("rowheader").first()).toContainText(cpi.title);
  await expect(page.getByRole("button", { name: `Reorder ${cpi.shortTitle}` })).toBeFocused();
  await expect.poll(async () => (await listNamed(page, "Macro watch"))?.marketIds[0]).toBe("cpi-oct");
  await page.getByRole("button", { name: "Done" }).click();

  // Share to room adds what the room's own list lacks.
  await page.getByRole("button", { name: "Share to room" }).click();
  await page.getByRole("menuitem", { name: room.name }).click();
  await expect(page.getByText(`Shared 5 markets to ${room.name}`)).toBeVisible();
  const shared = await api<{ watchlist: string[] }>(page, `rooms/${room.id}`);
  expect([...shared.watchlist].sort()).toEqual([...RATES].sort());

  // It all came from the server: a reload shows the same.
  await page.reload();
  await expect(page.getByRole("link", { name: /^Macro watch/ })).toBeVisible();

  // A new list starts empty and named as you type.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("List name").fill("Weather");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("This list is empty")).toBeVisible();
  await expect.poll(async () => (await listNamed(page, "Weather"))?.marketIds).toEqual([]);

  // Deleting asks first.
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page.getByText("Delete “Weather”?")).toBeVisible();
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page).not.toHaveURL(/list=/);
  await expect.poll(async () => await listNamed(page, "Weather")).toBeUndefined();
  expect(await listNamed(page, "Macro watch")).toBeTruthy();
});

test("on a phone a watchlist row swipes away (10.2)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newTrader(page, "Sid Swiper");
  const id = await makeList(page, "Long shots", ["starship", "fusion", "mars"]);
  const starship = await named(page, "starship");

  await page.goto(`/watchlist?list=${id}`);
  const row = page.getByRole("link", { name: new RegExp(`^${starship.shortTitle}`) });
  await expect(row).toBeVisible();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(`Removed ${starship.shortTitle} from Long shots`)).toBeVisible();
  await expect.poll(async () => (await listNamed(page, "Long shots"))?.marketIds).toEqual(["fusion", "mars"]);
});

test("a market saves to any list from its header (10.3)", async ({ page }) => {
  await newTrader(page, "Ada Adder");
  await makeList(page, "Long shots", ["starship"]);
  const mayor = await named(page, "mayor");

  await page.goto("/market/mayor");
  await page.getByRole("button", { name: "Add to watchlist", exact: true }).click();
  const popover = page.getByRole("dialog", { name: `Save ${mayor.shortTitle} to a watchlist` });
  await popover.getByLabel(/^Long shots/).check();
  await popover.getByLabel("New list name").fill("Election night");
  await popover.getByRole("button", { name: "Add" }).click();
  await expect(popover.getByLabel(/^Election night/)).toBeChecked();
  await expect.poll(async () => (await listNamed(page, "Long shots"))?.marketIds).toEqual(["starship", "mayor"]);
  expect((await listNamed(page, "Election night"))?.marketIds).toEqual(["mayor"]);

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  // The button now names the list it's in, and how many more.
  await expect(page.getByRole("button", { name: "In “Long shots” +1" })).toBeFocused();
});

test("a market is watched and unwatched from Discover's rows", async ({ page }) => {
  await newTrader(page, "Dee Discover");
  // Closing soon puts the mayoral race first: it closes before every other
  // open market in the design's catalog.
  const mayor = await named(page, "mayor");

  await page.goto("/discover?sort=Closing%20soon");
  const first = page.locator("[data-market]").first();
  await expect(first).toContainText(mayor.title);
  await first.getByRole("button", { name: `Add ${mayor.shortTitle} to watchlist` }).click();
  await expect(first.getByRole("button", { name: `Remove ${mayor.shortTitle} from watchlist` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(async () => (await lists(page)).find((l) => l.isDefault)?.marketIds).toEqual(["mayor"]);

  await page.goto("/watchlist");
  await expect(page.getByRole("link", { name: mayor.title })).toBeVisible();
  await page.getByRole("button", { name: `Remove ${mayor.shortTitle} from Saved markets` }).click();
  await expect(page.getByText("This list is empty")).toBeVisible();
  await expect.poll(async () => (await lists(page)).find((l) => l.isDefault)?.marketIds).toEqual([]);
});
