/**
 * Jupiter Predict execution against payloads shaped like the OpenAPI spec
 * (developers.jup.ag/docs/openapi-spec/prediction/prediction.yaml, October 7,
 * 2026). Live builds need a funded wallet, so these aren't recordings; field
 * names and units follow the spec exactly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedHttp, type Recording } from "@imo/server/adapters/memory/http";
import { createLogger, ManualClock, memorySecrets, TokenBucketLimiter } from "@imo/server/adapters/memory/runtime";
import { VenueRejection } from "../src/sdk/execution";
import { createJupiterExecution, MIN_ORDER, USDC_MINT } from "../src/jupiter/execution";

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ORDER = "Ord3rPubkey1111111111111111111111111111111";
const POSITION = "Pos1tionPubkey11111111111111111111111111111";
const ref = { venueId: "jupiter", externalId: "POLY-559653" };

const build = (overrides: Record<string, unknown> = {}) => ({
  transaction: "AQAAAA==",
  txMeta: { blockhash: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", lastValidBlockHeight: 312_000_150 },
  externalOrderId: "ext-1",
  requiredSigners: [OWNER],
  execution: { endpoint: "/prediction/v1/execute", context: { type: "create_order", orderPubkey: ORDER } },
  executionModel: null,
  settlement: null,
  order: {
    orderPubkey: ORDER,
    orderAtaPubkey: "Ata1111111111111111111111111111111111111111",
    userPubkey: OWNER,
    marketId: ref.externalId,
    marketIdHash: "hash",
    positionPubkey: POSITION,
    isBuy: true,
    isYes: true,
    contracts: "14",
    contractsMicro: "14285714",
    contractsDecimal: "14.28",
    newContracts: "14",
    newContractsMicro: "14285714",
    newContractsDecimal: "14.28",
    maxBuyPriceUsd: "700000",
    minSellPriceUsd: null,
    externalOrderId: "ext-1",
    orderCostUsd: "9850000",
    newAvgPriceUsd: "689655",
    newSizeUsd: "9850000",
    newPayoutUsd: "14280000",
    payoutUsd: "14280000",
    estimatedProtocolFeeUsd: "0",
    estimatedVenueFeeUsd: "150000",
    estimatedTotalFeeUsd: "150000",
    slippageBps: 40,
    ...overrides,
  },
});

const history = {
  data: [
    { id: 903, eventType: "order_closed", timestamp: 1_791_000_030, orderPubkey: ORDER, positionPubkey: POSITION },
    {
      id: 902,
      eventType: "order_filled",
      signature: "sig-fill",
      timestamp: 1_791_000_020,
      orderPubkey: ORDER,
      positionPubkey: POSITION,
      isBuy: true,
      isYes: true,
      filledContractsMicro: "14280000",
      avgFillPriceUsd: "690000",
      totalCostUsd: "9853200",
      feeUsd: "150000",
    },
    { id: 901, eventType: "order_created", timestamp: 1_791_000_000, orderPubkey: ORDER, positionPubkey: POSITION },
    { id: 870, eventType: "order_filled", timestamp: 1_790_000_000, orderPubkey: "SomeOtherOrder", filledContractsMicro: "1000000", avgFillPriceUsd: "100000" },
  ],
  pagination: { start: 0, end: 50, total: 4, hasNext: false },
};

const position = {
  pubkey: POSITION,
  owner: OWNER,
  ownerPubkey: OWNER,
  market: "MarketPda111111111111111111111111111111111",
  marketId: ref.externalId,
  marketIdHash: "hash",
  isYes: true,
  contracts: "14",
  contractsMicro: "14280000",
  contractsDecimal: "14.28",
  totalCostUsd: "9853200",
  sizeUsd: "9853200",
  valueUsd: "10281600",
  avgPriceUsd: "690000",
  markPriceUsd: "720000",
  sellPriceUsd: "720000",
  pnlUsd: "428400",
  pnlUsdPercent: 4.35,
  pnlUsdAfterFees: "278400",
  pnlUsdAfterFeesPercent: 2.83,
  openOrders: 0,
  feesPaidUsd: "150000",
  realizedPnlUsd: 0,
  claimed: false,
  claimedUsd: "0",
  openedAt: 1_791_000_020,
  updatedAt: 1_791_000_030,
  claimableAt: null,
  payoutUsd: "14280000",
  bump: 254,
  eventId: "evt",
  eventMetadata: {},
  marketMetadata: {},
  settlementDate: null,
  claimable: false,
};

const error = (status: number, code: string, message: string): Recording["body"] => ({
  type: "invalid_request_error",
  code,
  message,
  request_id: "req",
});

function venue(extra: Recording[] = [], key?: string) {
  const clock = new ManualClock("2026-10-07T05:00:00Z");
  const http = new ScriptedHttp([
    ...extra,
    { method: "POST", url: /\/orders$/, body: build() },
    { method: "DELETE", url: /\/positions\/Pos1tion/, body: build({ isBuy: false, maxBuyPriceUsd: null, minSellPriceUsd: "700000" }) },
    { method: "POST", url: /\/execute$/, body: { status: "Success", signature: "5igLanded", error: null, requestId: "r" } },
    { url: /\/orders\/status\//, body: { orderPubkey: ORDER, status: "filled", latestEventType: "order_closed", latestSignature: "s", externalOrderId: "e", orderId: "o", history: [] } },
    { url: /\/history\?/, body: history },
    { url: /\/positions\?/, body: { data: [position], pagination: { start: 0, end: 100, total: 1, hasNext: false } } },
    {
      method: "POST",
      url: /\/claim$/,
      body: {
        transaction: "AgAAAA==",
        txMeta: { blockhash: "bh", lastValidBlockHeight: 1 },
        position: { positionPubkey: POSITION, marketPubkey: "m", userPubkey: OWNER, ownerPubkey: OWNER, isYes: true, contracts: "14", payoutAmountUsd: "14280000" },
      },
    },
  ]);
  const secrets = memorySecrets(key ? { JUPITER_API_KEY: key } : {});
  return {
    http,
    venue: createJupiterExecution({
      http,
      rateLimiter: new TokenBucketLimiter({ "jupiter:trade": { perSecond: 1e6, capacity: 1e6 } }, clock),
      secrets,
      log: createLogger(() => {}),
      clock,
      config: {},
    }),
  };
}

test("a buy builds a USDC deposit order for the trader to sign", async () => {
  const { venue: v, http } = venue([], "jup_test");
  const ticket = await v.buildOrder({ side: "buy", owner: OWNER, ref, outcome: "yes", amount: 10_000_000 });
  const sent = http.calls[0]!;
  assert.deepEqual(sent.request?.body, {
    ownerPubkey: OWNER,
    marketId: "POLY-559653",
    isYes: true,
    isBuy: true,
    depositAmount: "10000000",
    depositMint: USDC_MINT,
  });
  assert.equal(sent.request?.headers?.["x-api-key"], "jup_test");
  assert.equal(ticket.orderId, ORDER);
  assert.equal(ticket.positionId, POSITION);
  assert.deepEqual(ticket.tx.signers, [OWNER]);
  assert.equal(ticket.estimate.quantity, 1428, "14.28 contracts in hundredths");
  assert.equal(ticket.estimate.notional, 9_850_000);
  assert.equal(ticket.estimate.price, 700_000);
  assert.equal(ticket.estimate.fees.total, 150_000);
  assert.equal(ticket.estimate.payoutIfWins, 14_280_000);
});

test("orders under $5 never reach Jupiter", async () => {
  const { venue: v, http } = venue();
  await assert.rejects(
    v.buildOrder({ side: "buy", owner: OWNER, ref, outcome: "yes", amount: MIN_ORDER - 1 }),
    (e: unknown) => e instanceof VenueRejection && e.code === "min_order",
  );
  assert.equal(http.calls.length, 0);
});

test("a build that wants someone else's signature is refused", async () => {
  const { venue: v } = venue([{ method: "POST", url: /\/orders$/, body: { ...build(), requiredSigners: [OWNER, "SomeoneElse111111111111111111111111111111111"] } }]);
  await assert.rejects(
    v.buildOrder({ side: "buy", owner: OWNER, ref, outcome: "yes", amount: 10_000_000 }),
    (e: unknown) => e instanceof VenueRejection && /unexpected signer/.test(e.message),
  );
});

test("Jupiter's errors become rejections the trader can act on", async () => {
  const cases: [string, string, string][] = [
    ["INSUFFICIENT_FUNDS", "Insufficient funds", "insufficient_funds"],
    ["no_shares_available", "Not enough shares available right now. Try again later.", "no_liquidity"],
    ["create_order_failed", "Minimum order is $5", "min_order"],
  ];
  for (const [code, message, expected] of cases) {
    const { venue: v } = venue([{ method: "POST", url: /\/orders$/, status: 400, body: error(400, code, message) }]);
    await assert.rejects(
      v.buildOrder({ side: "buy", owner: OWNER, ref, outcome: "no", amount: 10_000_000 }),
      (e: unknown) => e instanceof VenueRejection && e.code === expected,
      code,
    );
  }
});

test("selling everything closes the position; a partial sell names the contracts", async () => {
  const { venue: all, http: h1 } = venue();
  const t = await all.buildOrder({ side: "sell", owner: OWNER, ref, outcome: "yes", positionId: POSITION, quantity: "all" });
  assert.equal(h1.calls[0]!.request?.method, "DELETE");
  assert.deepEqual(h1.calls[0]!.request?.body, { ownerPubkey: OWNER });
  assert.equal(t.estimate.price, 700_000, "a sell's floor price");

  const { venue: part, http: h2 } = venue();
  await part.buildOrder({ side: "sell", owner: OWNER, ref, outcome: "yes", positionId: POSITION, quantity: 500 });
  assert.deepEqual(h2.calls[0]!.request?.body, {
    ownerPubkey: OWNER,
    positionPubkey: POSITION,
    isYes: true,
    isBuy: false,
    contractsMicro: "5000000",
  });
});

test("a signed transaction lands through /execute with the build's context", async () => {
  const { venue: v, http } = venue();
  const ticket = await v.buildOrder({ side: "buy", owner: OWNER, ref, outcome: "yes", amount: 10_000_000 });
  const { signature } = await v.submit("c2lnbmVk", ticket.tx);
  assert.equal(signature, "5igLanded");
  const call = http.calls.at(-1)!;
  assert.equal(call.request?.idempotent, false, "never retried blindly");
  assert.deepEqual(call.request?.body, { signedTransaction: "c2lnbmVk", context: { type: "create_order", orderPubkey: ORDER } });

  const { venue: failing } = venue([{ method: "POST", url: /\/execute$/, body: { status: "Failed", signature: null, error: "Blockhash expired", requestId: "r" } }]);
  await assert.rejects(failing.submit("c2lnbmVk", ticket.tx), (e: unknown) => e instanceof VenueRejection && /Blockhash expired/.test(e.message));
});

test("a filled order reports its fills, and only its own", async () => {
  const { venue: v } = venue();
  const status = await v.orderStatus(ORDER, OWNER);
  assert.equal(status.state, "filled");
  assert.ok(status.final);
  assert.equal(status.fills.length, 1);
  const [fill] = status.fills;
  assert.equal(fill!.id, "jupiter:902");
  assert.equal(fill!.quantity, 1428);
  assert.equal(fill!.price, 690_000);
  assert.equal(fill!.notional, 9_853_200);
  assert.equal(fill!.fee, 150_000);
});

test("an order with no history yet is still on its way", async () => {
  const { venue: v } = venue([{ url: /\/orders\/status\//, status: 404, body: error(404, "order_not_found", "Order not found") }]);
  assert.deepEqual(await v.orderStatus(ORDER, OWNER), { state: "submitted", final: false, fills: [] });
});

test("positions map to contracts, cost and payout", async () => {
  const { venue: v } = venue();
  const [p] = await v.positions(OWNER);
  assert.equal(p!.id, POSITION);
  assert.deepEqual(p!.ref, ref);
  assert.equal(p!.outcome, "yes");
  assert.equal(p!.quantity, 1428);
  assert.equal(p!.cost, 9_853_200);
  assert.equal(p!.value, 10_281_600);
  assert.equal(p!.payout, 14_280_000);
  assert.equal(p!.claimable, false);
});

test("a claim builds a payout transaction", async () => {
  const { venue: v } = venue();
  const claim = await v.buildClaim(POSITION, OWNER);
  assert.equal(claim.payout, 14_280_000);
  assert.deepEqual(claim.tx.signers, [OWNER]);
  const { venue: early } = venue([{ method: "POST", url: /\/claim$/, status: 400, body: error(400, "claim_position_failed", "Market not settled yet") }]);
  await assert.rejects(early.buildClaim(POSITION, OWNER), (e: unknown) => e instanceof VenueRejection && e.code === "not_settled");
});
