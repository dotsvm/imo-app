/**
 * SKR in the wallet: its balance, a swap to USDC through Jupiter, and tips to
 * a prediction's author. The chain and Jupiter are faked; what's checked is
 * that only the trader signs, and only what was built is relayed.
 */
process.env.TRADING = "wallet";
process.env.API_RATE_SCALE = "10";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { SKR } from "@imo/server/catalogs";
import { GET as wallet } from "../../src/app/api/v1/wallet/route";
import { GET as quote } from "../../src/app/api/v1/wallet/skr/quote/route";
import { POST as swap } from "../../src/app/api/v1/wallet/skr/swap/route";
import { POST as swapSubmit } from "../../src/app/api/v1/wallet/skr/swap/submit/route";
import { GET as tips, POST as tip } from "../../src/app/api/v1/posts/[id]/tips/route";
import { POST as tipSubmit } from "../../src/app/api/v1/posts/[id]/tips/submit/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TIPPER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const AUTHOR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

let tipper = "";
let author = "";
let postId = "";
const sent: string[] = [];
const jupiterCalls: string[] = [];

/** What the wallet hands back: the same message, now signed. */
const sign = (base64: string) => {
  const bytes = Buffer.from(base64, "base64");
  bytes.fill(7, 1, 65);
  return bytes.toString("base64");
};
const decode = (base64: string) =>
  getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(base64, "base64")).messageBytes);

/** A swap-shaped transaction, as Jupiter would build it: `payer` pays, and
    `alsoSigns` (if any) would have to sign too. */
function jupiterTx(payer: string, alsoSigns?: string) {
  const fee = createNoopSigner(address(payer));
  const other = alsoSigns ? createNoopSigner(address(alsoSigns)) : fee;
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(fee, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 100n }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [getTransferCheckedInstruction({ source: address(AUTHOR), mint: address(SKR.mint), destination: address(USDC), authority: other, amount: 1n, decimals: 6 })],
        m,
      ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
let swapTx = "";

async function userWithWallet(subject: string, name: string, solana: string) {
  const auth = await signIn(subject, name);
  await call(wallet, "/api/v1/wallet", { auth }); // the first request creates the account and its wallet
  const [user] = await deps().db.select({ id: t.users.id }).from(t.users).where(eq(t.users.displayName, name));
  await deps().db.update(t.wallets).set({ address: solana }).where(and(eq(t.wallets.userId, user!.id), eq(t.wallets.chain, "solana")));
  return { auth, id: user!.id };
}

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  const [market] = await deps().db.select().from(t.markets).where(eq(t.markets.slug, "fed-dec"));
  (deps().venues.execution as Map<string, unknown>).set(market!.venueId, {
    module: { id: "memory", venues: [market!.venueId], collateral: { chain: "solana", mint: USDC, decimals: 6, symbol: "USDC" } },
    venue: { minOrder: 5_000_000 },
  });
  const a = await userWithWallet("skr-tipper", "Skr Tipper", TIPPER);
  const b = await userWithWallet("skr-author", "Skr Author", AUTHOR);
  tipper = a.auth;
  author = b.auth;
  const [post] = await deps()
    .db.insert(t.posts)
    .values({
      authorId: b.id,
      marketId: market!.id,
      outcome: "Yes",
      entryPrice: 600_000,
      text: "Two voters flipped dovish in last week's minutes.",
      confidence: "Medium",
      editableUntil: new Date(),
    })
    .returning({ id: t.posts.id });
  postId = post!.id;

  (deps() as { chain: unknown }).chain = {
    balances: async () => ({ lamports: 20_000_000, tokens: { [USDC]: 25_000_000, [SKR.mint]: 500_000_000 } }),
    latestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
    send: async (signed: string) => (sent.push(signed), `5igSkr${sent.length}`),
    status: async () => ({ confirmed: true, error: null }),
  };
  // The test profile's clock is manual, so token buckets never refill.
  (deps() as { rateLimiter: unknown }).rateLimiter = { acquire: async () => {}, tryAcquire: async () => true };
  (deps() as { http: unknown }).http = {
    json: async (url: string) => {
      jupiterCalls.push(url);
      if (url.includes("/quote"))
        return { inAmount: "100000000", outAmount: "1686093", otherAmountThreshold: "1669232", priceImpactPct: "0.0009" };
      return { swapTransaction: swapTx };
    },
  };
});
after(async () => deps().database?.close());

test("the wallet shows SKR beside USDC", async () => {
  const { status, body } = await call<{ balance: { usdcCents: number; skr: number } }>(wallet, "/api/v1/wallet", { auth: tipper });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.balance.skr, 500);
  assert.equal(body.balance.usdcCents, 2_500);
});

test("a swap quote is SKR in, USDC out, from Jupiter's keyless host", async () => {
  const { status, body } = await call<{ skr: number; usdcCents: number; minUsdcCents: number }>(quote, "/api/v1/wallet/skr/quote?skr=100", { auth: tipper });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual([body.skr, body.usdcCents, body.minUsdcCents], [100, 168, 166]);
  const url = new URL(jupiterCalls.at(-1)!);
  assert.equal(url.host, "lite-api.jup.ag");
  assert.equal(url.searchParams.get("inputMint"), SKR.mint);
  assert.equal(url.searchParams.get("outputMint"), USDC);
  assert.equal(url.searchParams.get("amount"), "100000000");
});

test("a swap Jupiter builds for anyone else to sign is refused", async () => {
  swapTx = jupiterTx(TIPPER, AUTHOR);
  const refused = await call<{ error: { code: string } }>(swap, "/api/v1/wallet/skr/swap", { auth: tipper, body: { skr: 100 } });
  assert.equal(refused.status, 502);
  assert.equal(refused.body.error.code, "swap_unavailable");
  swapTx = jupiterTx(AUTHOR);
  const notPayer = await call(swap, "/api/v1/wallet/skr/swap", { auth: tipper, body: { skr: 100 } });
  assert.equal(notPayer.status, 502, "the trader must pay the fee");
});

test("a swap is signed by the trader alone and relayed as built", async () => {
  const tooMuch = await call<{ error: { code: string } }>(swap, "/api/v1/wallet/skr/swap", { auth: tipper, body: { skr: 501 } });
  assert.equal(tooMuch.body.error.code, "insufficient_funds");

  swapTx = jupiterTx(TIPPER);
  const built = await call<{ transaction: string; signers: string[]; usdcCents: number }>(swap, "/api/v1/wallet/skr/swap", { auth: tipper, body: { skr: 100 } });
  assert.equal(built.status, 200, JSON.stringify(built.body));
  assert.deepEqual(built.body.signers, [TIPPER]);
  assert.equal(built.body.transaction, swapTx, "exactly Jupiter's transaction");

  const forged = await call(swapSubmit, "/api/v1/wallet/skr/swap/submit", { auth: tipper, body: { signedTransaction: sign(jupiterTx(TIPPER, AUTHOR)) } });
  assert.equal(forged.status, 422);
  const before = sent.length;
  const done = await call<{ signature: string; status: string; skr: number; usdcCents: number }>(swapSubmit, "/api/v1/wallet/skr/swap/submit", {
    auth: tipper,
    body: { signedTransaction: sign(built.body.transaction) },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.status, done.body.skr, done.body.usdcCents], ["confirmed", 100, 168]);
  assert.equal(sent.length, before + 1);
  const again = await call(swapSubmit, "/api/v1/wallet/skr/swap/submit", { auth: tipper, body: { signedTransaction: sign(built.body.transaction) } });
  assert.equal(again.status, 409, "the build is used up");
});

test("a tip is an SKR transfer to the author, relayed as built and recorded", async () => {
  const own = await call(tip, `/api/v1/posts/${postId}/tips`, { params: { id: postId }, auth: author, body: { skr: 10 } });
  assert.equal(own.status, 422, "not your own prediction");

  const built = await call<{ transaction: string; signers: string[]; skr: number }>(tip, `/api/v1/posts/${postId}/tips`, { params: { id: postId }, auth: tipper, body: { skr: 25 } });
  assert.equal(built.status, 200, JSON.stringify(built.body));
  assert.deepEqual(built.body.signers, [TIPPER]);
  const message = decode(built.body.transaction);
  assert.equal(message.staticAccounts[0], TIPPER, "the tipper pays the fee");
  assert.equal(message.header.numSignerAccounts, 1, "and is the only signer");
  assert.ok("instructions" in message);
  assert.equal(message.instructions.length, 2, "open the author's SKR account if needed, then transfer");
  assert.ok(message.staticAccounts.includes(address(AUTHOR)), "to the author's wallet");

  const other = crypto.randomUUID();
  const elsewhere = await call(tipSubmit, `/api/v1/posts/${other}/tips/submit`, {
    params: { id: other },
    auth: tipper,
    body: { signedTransaction: sign(built.body.transaction) },
  });
  assert.equal(elsewhere.status, 409, "a tip built for one post can't land on another");

  const done = await call<{ status: string; skr: number; tips: { count: number; skr: number } }>(tipSubmit, `/api/v1/posts/${postId}/tips/submit`, {
    params: { id: postId },
    auth: tipper,
    body: { signedTransaction: sign(built.body.transaction) },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.status, done.body.skr], ["confirmed", 25]);
  assert.deepEqual(done.body.tips, { count: 1, skr: 25 });

  const summary = await call<{ count: number; skr: number }>(tips, `/api/v1/posts/${postId}/tips`, { params: { id: postId } });
  assert.deepEqual(summary.body, { count: 1, skr: 25 });
});
