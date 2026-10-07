import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { GET as me } from "../../src/app/api/v1/me/route";
import { GET as available } from "../../src/app/api/v1/handles/[handle]/route";
import { GET as size, POST as joinByEmail } from "../../src/app/api/v1/waitlist/route";
import { GET as status } from "../../src/app/api/v1/waitlist/me/route";
import { POST as claim } from "../../src/app/api/v1/waitlist/claim/route";
import { POST as share } from "../../src/app/api/v1/waitlist/share/route";
import { POST as opens } from "../../src/app/api/v1/waitlist/opens/route";
import { passCard } from "@imo/server/usecases/waitlist";
import { POST as orders } from "../../src/app/api/v1/orders/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const clock = () => deps().clock as unknown as { advance(ms: number): void };
const auth: Record<string, string> = {};

type Status = {
  onList: boolean;
  handle: string;
  email: string | null;
  position: number | null;
  pass: number | null;
  founding: boolean;
  edition: string;
  issuedAt: string | null;
  boost: number;
  shared: boolean;
  opens: number;
  referrals: number;
  waiting: number;
  joined: number;
  passesLeft: number;
  granted: boolean;
};
type Availability = { handle: string; available: boolean; reason: string | null; yours: boolean };
const check = (handle: string, as?: string) =>
  call<Availability>(available, `/api/v1/handles/${handle}`, { params: { handle }, auth: as });

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  // The beta is closed: people wait for an invite (flags cache for ten seconds).
  await deps().db.insert(t.flags).values({ key: "beta_gate", enabled: true });
  clock().advance(11_000);
  auth.ana = await signIn("wait-ana", "Ana Early", "ana@example.com");
  auth.ben = await signIn("wait-ben", "Ben Later", "ben@example.com");
  auth.wallet = await signIn("wait-wallet", "Wallet Only");
  for (const who of [auth.ana, auth.ben, auth.wallet]) await call(me, "/api/v1/me", { auth: who });
});
after(async () => deps().close());
beforeEach(() => clock().advance(1_000));

test("a handle answers free, taken, reserved or malformed — to anyone", async () => {
  assert.deepEqual((await check("fresh_name")).body, { handle: "fresh_name", available: true, reason: null, yours: false });
  // Ana's sign-up gave her "ana", from her email.
  assert.deepEqual((await check("ANA")).body, { handle: "ANA", available: false, reason: "taken", yours: false });
  for (const [handle, reason] of [
    ["Admin", "reserved"],
    ["imo", "reserved"],
    ["x", "invalid"],
    ["has space", "invalid"],
    ["way_too_long_for_a_handle_on_imo", "invalid"],
  ] as const) {
    const res = await check(encodeURIComponent(handle));
    assert.equal(res.body.available, false, handle);
    assert.equal(res.body.reason, reason, handle);
  }
});

test("claiming takes a signed-in account with an email, and holds your place", async () => {
  const anonymous = await call(claim, "/api/v1/waitlist/claim", { body: { handle: "ana" } });
  assert.equal(anonymous.status, 401, "a handle is held by a person");
  const wallet = await call<{ error: { message: string } }>(claim, "/api/v1/waitlist/claim", { auth: auth.wallet, body: { handle: "wally" } });
  assert.equal(wallet.status, 422, "no email, nowhere to send the invite");

  const ana = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.ana, body: { handle: "@ana_trades" } });
  assert.equal(ana.status, 200, "the gate doesn't stop you claiming");
  const { onList, handle, email, position, pass, founding, granted, issuedAt } = ana.body;
  assert.deepEqual({ onList, handle, email, position, pass, founding, granted }, {
    onList: true,
    handle: "ana_trades",
    email: "ana@example.com",
    position: 1,
    pass: 1,
    founding: true,
    granted: false,
  });
  assert.ok(issuedAt && !Number.isNaN(Date.parse(issuedAt)), "the pass is dated");
  const self = await check("ana_trades", auth.ana);
  assert.deepEqual([self.body.available, self.body.yours], [true, true], "yours, to you");
  const others = await check("ANA_TRADES", auth.ben);
  assert.deepEqual([others.body.available, others.body.reason], [false, "taken"], "taken, whatever the case");

  const ben = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.ben, body: { handle: "ben" } });
  assert.deepEqual([ben.body.position, ben.body.pass], [2, 2], "second in line, second pass");
  const counts = (await call<{ waiting: number; joined: number; passesLeft: number }>(size, "/api/v1/waitlist")).body;
  assert.deepEqual(counts, { waiting: 2, joined: 2, passesLeft: 998 });

  // Taken, reserved and malformed claims are refused, and your place stands.
  const clash = await call<{ error: { code: string } }>(claim, "/api/v1/waitlist/claim", { auth: auth.ben, body: { handle: "Ana_Trades" } });
  assert.deepEqual([clash.status, clash.body.error.code], [409, "handle_taken"]);
  const reserved = await call(claim, "/api/v1/waitlist/claim", { auth: auth.ben, body: { handle: "support" } });
  assert.equal(reserved.status, 422);
  const bad = await call(claim, "/api/v1/waitlist/claim", { auth: auth.ben, body: { handle: "no spaces" } });
  assert.equal(bad.status, 422);

  // A second claim renames you; your place doesn't move.
  const renamed = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.ana, body: { handle: "AnaT" } });
  assert.deepEqual([renamed.body.handle, renamed.body.position], ["AnaT", 1]);
  const profile = await call<{ user: { handle: string }; settings: { onboarded: boolean } }>(me, "/api/v1/me", { auth: auth.ana });
  assert.deepEqual([profile.body.user.handle, profile.body.settings.onboarded], ["AnaT", true], "no second welcome step");

  // Waiting still means waiting: taking part needs an invite.
  const trade = await call(orders, "/api/v1/orders", {
    auth: auth.ana,
    body: { market: "nope", side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: "wait-order-1" },
  });
  assert.equal(trade.status, 403);
});

test("an email already on the list keeps its earlier place when its owner claims", async () => {
  await call(joinByEmail, "/api/v1/waitlist", { body: { email: "cat@example.com" } });
  clock().advance(5_000);
  auth.cat = await signIn("wait-cat", "Cat Earlybird", "Cat@Example.com");
  await call(me, "/api/v1/me", { auth: auth.cat });
  const cat = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.cat, body: { handle: "cat" } });
  assert.equal(cat.body.email, "cat@example.com");
  assert.equal(cat.body.position, 3, "behind the two before her, not behind everyone since");
  const [row] = await deps().db.select().from(t.waitlist).where(eq(t.waitlist.email, "cat@example.com"));
  assert.ok(row.userId, "the entry now belongs to her account");
});

test("where you stand, before and after claiming; let in means out of the line", async () => {
  auth.dee = await signIn("wait-dee", "Dee Undecided", "dee@example.com");
  await call(me, "/api/v1/me", { auth: auth.dee });
  const before = await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.dee });
  assert.deepEqual([before.body.onList, before.body.position, before.body.email], [false, null, "dee@example.com"]);
  // Ana is let in: she leaves the line, and everyone behind her moves up.
  const [ana] = await deps().db.select({ id: t.users.id }).from(t.users).where(eq(t.users.handle, "AnaT"));
  await deps().db.update(t.users).set({ accessGrantedAt: new Date() }).where(eq(t.users.id, ana.id));
  const ben = await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.ben });
  assert.equal(ben.body.position, 1);
  assert.equal(ben.body.pass, 2, "a pass number never moves; a place in line does");
  const anaNow = await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.ana });
  assert.deepEqual([anaNow.body.granted, anaNow.body.position, anaNow.body.pass], [true, null, 1]);
  assert.equal(before.body.pass, null, "no pass before claiming");
});

test("a pass keeps its edition; sharing it and friends' claims move you up the line", async () => {
  auth.eve = await signIn("wait-eve", "Eve Early", "eve@example.com");
  auth.fay = await signIn("wait-fay", "Fay Friend", "fay@example.com");
  auth.gus = await signIn("wait-gus", "Gus Guest", "gus@example.com");
  for (const who of [auth.eve, auth.fay, auth.gus]) await call(me, "/api/v1/me", { auth: who });

  // In line now: Ben (pass 2), Cat (pass 3). Eve joins third, in Macro.
  const eve = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.eve, body: { handle: "eve", edition: "macro" } });
  assert.deepEqual([eve.body.pass, eve.body.position, eve.body.edition], [4, 3, "macro"]);
  const bad = await call(claim, "/api/v1/waitlist/claim", { auth: auth.eve, body: { handle: "eve", edition: "gold" } });
  assert.equal(bad.status, 400, "editions are the four on the page");

  // Fay comes through Eve's link: Eve moves up ten places, to the front.
  const fay = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.fay, body: { handle: "fay", ref: "@Eve" } });
  assert.deepEqual([fay.status, fay.body.pass, fay.body.boost], [200, 5, 0]);
  const eveNow = await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.eve });
  assert.deepEqual(
    [eveNow.body.boost, eveNow.body.referrals, eveNow.body.position, eveNow.body.pass],
    [10, 1, 1, 4],
    "a friend's claim: +10 places; the pass number stays",
  );
  // Only newcomers can be sent: claiming again credits no one.
  await call(claim, "/api/v1/waitlist/claim", { auth: auth.fay, body: { handle: "fay_two", ref: "eve" } });
  assert.equal((await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.eve })).body.boost, 10);
  // Nor does your own link.
  const gus = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.gus, body: { handle: "gus", ref: "gus" } });
  assert.deepEqual([gus.body.boost, gus.body.position], [0, 5]);

  // Sharing the pass: +10, once.
  const shared = await call<Status>(share, "/api/v1/waitlist/share", { auth: auth.gus });
  assert.deepEqual([shared.body.shared, shared.body.boost, shared.body.position], [true, 10, 2]);
  const again = await call<Status>(share, "/api/v1/waitlist/share", { auth: auth.gus });
  assert.deepEqual([again.body.boost, again.body.position], [10, 2], "sharing moves you up once");
  const outsider = await call(share, "/api/v1/waitlist/share", { auth: auth.dee });
  assert.equal(outsider.status, 422, "nothing to share before claiming");

  // Opening someone's link counts for their card; an unknown handle counts for no one.
  assert.equal((await call(opens, "/api/v1/waitlist/opens", { body: { handle: "Eve" } })).status, 202);
  await call(opens, "/api/v1/waitlist/opens", { body: { handle: "@eve" } });
  await call(opens, "/api/v1/waitlist/opens", { body: { handle: "nobody_here" } });
  assert.equal((await call<Status>(status, "/api/v1/waitlist/me", { auth: auth.eve })).body.opens, 2);

  // The pass, as the link's preview shows it.
  assert.deepEqual(await passCard(deps().db, "EVE"), { handle: "eve", pass: 4, founding: true, edition: "macro" });
  assert.equal(await passCard(deps().db, "nobody_here"), null);
});

test("level on the mark, the bigger boost goes first: a share moves you ten places", async () => {
  // Eleven people join just before Hal, none of them boosted.
  const start = deps().clock.now().getTime();
  await deps()
    .db.insert(t.waitlist)
    .values(Array.from({ length: 11 }, (_, i) => ({ email: `level-${i}@example.com`, createdAt: new Date(start + i * 1_000) })));
  clock().advance(60_000);
  auth.hal = await signIn("wait-hal", "Hal Level", "hal@example.com");
  await call(me, "/api/v1/me", { auth: auth.hal });
  const joined = await call<Status>(claim, "/api/v1/waitlist/claim", { auth: auth.hal, body: { handle: "hal" } });
  const shared = await call<Status>(share, "/api/v1/waitlist/share", { auth: auth.hal });
  assert.equal(joined.body.position! - shared.body.position!, 10, "level with the person ten ahead, Hal goes first");
});
