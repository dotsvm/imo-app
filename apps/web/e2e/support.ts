/**
 * What every end-to-end test shares. State is read back through /api/v1 —
 * the same answers the screens get — never from the browser's storage.
 *
 * People: the seeded viewer is Jordan Reyes (dev subject "you", @jordan).
 * The design's other people are seeded without a way to sign in; their
 * handles are in HANDLES. A test that writes signs in as a fresh trader.
 */
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

export { expect };

let address = 0;
/** A client address of its own, so per-address rate budgets (sign-in above
    all) belong to one test and never spill into the next. */
const nextAddress = () => {
  address += 1;
  return `10.${(process.pid % 200) + 20}.${Math.floor(address / 250) % 250}.${(address % 250) + 1}`;
};

export const test = base.extend({
  // (Playwright's `use`, named so React's hook lint leaves it alone.)
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress() });
    await provide(context);
  },
});

/** The design's people by the names the design used for them. */
/** The waitlist app (apps/waitlist), which the stack runs on the next port. */
export const WAITLIST_URL = `http://localhost:${Number(process.env.E2E_PORT ?? "3100") + 1}`;

export const HANDLES = {
  you: "jordan",
  mira: "mirak",
  luis: "lvprado",
  ren: "rtanaka",
  hazel: "hazelq",
  dayo: "dayo",
  ann: "north",
  sam: "sampling",
  sofia: "sofiac",
  priya: "priyash",
  amara: "amarao",
  eli: "elibrooks",
  noah: "noahk",
  leo: "leom",
  owen: "owenc",
  ines: "inesd",
} as const;

/** JSON from the API, as this browser context (its session cookie). */
export async function api<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; data?: unknown } = {},
): Promise<T> {
  const method = init.method ?? (init.data === undefined ? "GET" : "POST");
  const res = await page.request.fetch(`/api/v1/${path}`, { method, data: init.data });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} /api/v1/${path} → ${res.status()}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export interface Me {
  user: { id: string; handle: string; displayName: string; bio: string; avatarUrl: string | null };
  settings: { onboarded: boolean; email: string | null; interests: string[] };
  account: { cashCents: number; reservedCents: number; availableCents: number };
  wallets: { chain: string; address: string; custody: string }[];
}
export const me = (page: Page) => api<Me>(page, "me");

/** The seeded viewer, signed in before the first page loads (the app would
    do it on its own, after a 401 the console would report). */
export async function asSeededViewer(page: Page) {
  await api(page, "dev/session", { data: { subject: "you", name: "Jordan Reyes" } });
}

let traders = 0;
/**
 * Sign this browser context in as a brand-new paper trader: $10,000, nothing
 * held, and (unless asked otherwise) past onboarding, so pages open on the
 * app rather than the welcome steps.
 */
export async function newTrader(page: Page, name = "E2E Trader", { onboarded = true } = {}) {
  traders += 1;
  const subject = `e2e-${Date.now().toString(36)}-${process.pid.toString(36)}-${traders.toString(36)}`.slice(0, 40);
  await api(page, "dev/session", { data: { subject, name, email: `${subject}@example.com` } });
  const who = await me(page);
  if (onboarded) await api(page, "me", { method: "PATCH", data: { onboarded: true, interests: ["Economics", "Crypto"] } });
  return { subject, id: who.user.id, handle: who.user.handle, name };
}

/** Someone else in the same test, in a browser context of their own. */
export async function secondTrader(browser: Browser, name: string) {
  const context: BrowserContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "x-forwarded-for": nextAddress() },
  });
  const page = await context.newPage();
  const who = await newTrader(page, name);
  return { context, page, ...who };
}

/** A second person with a browser of their own (cookies, address) who
    hasn't signed in yet — on the waitlist, say. */
export async function newVisitor(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "x-forwarded-for": nextAddress() },
  });
  return { context, page: await context.newPage() };
}

/** A trader's prediction: the newest, or the first whose text matches. */
export async function postBy(page: Page, handle: string, text?: RegExp) {
  const { items } = await api<{ items: { id: string; text: string }[] }>(page, `posts?trader=${handle}&limit=50`);
  const found = text ? items.find((p) => text.test(p.text)) : items[0];
  if (!found) throw new Error(`No prediction by @${handle}${text ? ` matching ${text}` : ""}`);
  return found.id;
}

/** The signed-in person's open position on a market. */
export async function positionOn(page: Page, marketId: string, outcome?: "Yes" | "No") {
  const { positions } = await api<{ positions: { id: string; marketId: string; outcome: string; shares: number }[] }>(
    page,
    "portfolio",
  );
  const found = positions.find((p) => p.marketId === marketId && (!outcome || p.outcome === outcome));
  if (!found) throw new Error(`No position on ${marketId}`);
  return found;
}

/** Buy through the API, for tests about what comes after a trade. */
export async function buy(page: Page, market: string, outcome: "Yes" | "No", amountCents: number) {
  return api<{ status: string; filledShares: number }>(page, "orders", {
    data: { market, side: "Buy", outcome, amountCents, clientOrderId: crypto.randomUUID() },
  });
}

/** Collect page errors and console errors for a test to assert on. */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

/** 04.1: slide to review is a button too — Enter completes it. */
export const review = (scope: Locator) => scope.getByRole("button", { name: /Slide to review order/ }).press("Enter");

/** Place the reviewed order without the share-to-feed composer. */
export async function place(scope: Locator) {
  const share = scope.getByRole("checkbox", { name: "Share this trade to my feed after it fills" });
  if (await share.isChecked()) await share.uncheck();
  await scope.getByRole("button", { name: "Place order", exact: true }).click();
}
