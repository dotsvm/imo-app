import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import fc from "fast-check";
import {
  defineCurrency,
  divRound,
  formatUnits,
  money,
  mulDiv,
  parseUnits,
  rescale,
  roundToStep,
  add,
  type RoundingMode,
} from "../src/money";
import {
  computeFees,
  feeFor,
  type FeeModel,
  type FeeSchedule,
} from "../src/fees";
import {
  MARKET_STATUSES,
  canTransition,
  isFinal,
  type MarketStatus,
} from "../src/lifecycle";
import { complementLevels, isWellFormed, yesNo } from "../src/market";
import { quoteFromBook, type QuoteMarket } from "../src/quote";
import { existsSync } from "node:fs";
import {
  AVATAR_PRESETS,
  AVATAR_PRESET_IDS,
  defaultAvatar,
  presetOf,
  presetUrl,
} from "../src/avatars";

const MODES: RoundingMode[] = [
  "ceil",
  "floor",
  "trunc",
  "half-up",
  "half-even",
];

test("decimal strings parse exactly and refuse silent rounding", () => {
  assert.equal(parseUnits("0.4200", 6), 420_000);
  assert.equal(parseUnits("0.0025", 6), 2_500);
  assert.equal(parseUnits("13.00", 2), 1_300);
  assert.equal(parseUnits("-1.5", 2), -150);
  assert.throws(() => parseUnits("1.0000001", 6), /more than 6 decimals/);
  assert.equal(parseUnits("1.0000001", 6, "ceil"), 1_000_001);
  assert.throws(() => parseUnits("1e5", 6), /Not a decimal/);
});

test("formatting and parsing round-trip every amount at every scale", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1e12, max: 1e12 }),
      fc.integer({ min: 0, max: 9 }),
      (units, scale) => parseUnits(formatUnits(units, scale), scale) === units,
    ),
  );
});

test("each rounding mode lands on the right side of the exact quotient", () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
      fc.bigInt({ min: 1n, max: 10n ** 9n }),
      (n, d) => {
        const floor = divRound(n, d, "floor");
        const ceil = divRound(n, d, "ceil");
        assert.ok(floor * d <= n && n <= ceil * d);
        assert.ok(ceil - floor === 0n || ceil - floor === 1n);
        for (const mode of ["half-up", "half-even", "trunc"] as const) {
          const r = divRound(n, d, mode);
          assert.ok(r === floor || r === ceil, mode);
        }
        const trunc = divRound(n, d, "trunc");
        assert.equal(trunc, n / d);
      },
    ),
  );
  assert.equal(divRound(5n, 2n, "half-even"), 2n);
  assert.equal(divRound(7n, 2n, "half-even"), 4n);
  assert.equal(divRound(-5n, 2n, "half-up"), -3n);
});

test("scales convert without loss and products never touch floats", () => {
  fc.assert(
    fc.property(fc.integer({ min: -1e9, max: 1e9 }), (cents) => {
      const micros = rescale(cents, 2, 6, "trunc");
      return (
        micros === cents * 10_000 && rescale(micros, 6, 2, "trunc") === cents
      );
    }),
  );
  // 0.1 + 0.2 style drift can't happen: a large product stays exact.
  assert.equal(
    mulDiv(2 ** 40, 3_000_001, 1_000_000, "floor"),
    3_298_535_982_839,
  );
  assert.equal(roundToStep(12_345, 10_000, "ceil"), 20_000);
  assert.throws(
    () =>
      add(
        money(1),
        money(
          1,
          defineCurrency({ code: "USDC", scale: 6, displayDecimals: 2 }).code,
        ),
      ),
    /mismatch/,
  );
  assert.throws(
    () => defineCurrency({ code: "USD", scale: 2, displayDecimals: 2 }),
    /another scale/,
  );
});

const cents = (decimals = 2, mode: RoundingMode = "half-up") => ({
  mode,
  decimals,
});

test("fee models reproduce today's Kalshi and app fees exactly", () => {
  const kalshi: FeeModel = {
    kind: "quadratic",
    rate: "0.07",
    appliesTo: "both",
    rounding: cents(),
  };
  const app: FeeModel = {
    kind: "bps",
    bps: 50,
    appliesTo: "both",
    rounding: cents(),
  };
  const fill = {
    price: 50,
    quantity: 100,
    quantityScale: 0,
    currencyScale: 2,
    liquidity: "taker" as const,
  };
  assert.equal(feeFor(kalshi, fill), 175);
  assert.equal(feeFor(app, { ...fill, price: 10_001, quantity: 1 }), 50);
  // At micro-dollar precision with Kalshi's round-up: 13 contracts at $0.42.
  const micro: FeeModel = {
    ...kalshi,
    rounding: { mode: "ceil", decimals: 6 },
  };
  assert.equal(
    feeFor(micro, {
      price: 420_000,
      quantity: 1_300,
      quantityScale: 2,
      currencyScale: 6,
      liquidity: "taker",
    }),
    221_676,
  );
});

const feeModel: fc.Arbitrary<FeeModel> = fc.oneof(
  fc.constant<FeeModel>({ kind: "none" }),
  fc.record({
    kind: fc.constant("quadratic" as const),
    rate: fc.constantFrom("0.07", "0.05", "0.04", "0.035", "0"),
    appliesTo: fc.constantFrom("taker" as const, "both" as const),
    rounding: fc.record({
      mode: fc.constantFrom(...MODES),
      decimals: fc.constantFrom(6, 4, 2),
    }),
  }),
  fc.record({
    kind: fc.constant("bps" as const),
    bps: fc.integer({ min: 0, max: 200 }),
    appliesTo: fc.constantFrom("taker" as const, "both" as const),
    rounding: fc.record({
      mode: fc.constantFrom(...MODES),
      decimals: fc.constantFrom(6, 4, 2),
    }),
  }),
);

test("fees are never negative, land on their step, and spare makers when taker-only", () => {
  fc.assert(
    fc.property(
      feeModel,
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 5_000_000 }),
      fc.constantFrom("taker" as const, "maker" as const),
      (model, price, quantity, liquidity) => {
        const fee = feeFor(model, {
          price,
          quantity,
          quantityScale: 2,
          currencyScale: 6,
          liquidity,
        });
        assert.ok(fee >= 0);
        if (model.kind === "quadratic" || model.kind === "bps") {
          assert.equal(fee % 10 ** (6 - model.rounding.decimals), 0);
          if (model.appliesTo === "taker" && liquidity === "maker")
            assert.equal(fee, 0);
        }
      },
    ),
  );
});

test("the quadratic fee is symmetric around 50%", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 1_000_000 }),
      (price, quantity) => {
        const model: FeeModel = {
          kind: "quadratic",
          rate: "0.07",
          appliesTo: "both",
          rounding: { mode: "ceil", decimals: 6 },
        };
        const at = (p: number) =>
          feeFor(model, {
            price: p,
            quantity,
            quantityScale: 2,
            currencyScale: 6,
            liquidity: "taker",
          });
        return at(price) === at(1_000_000 - price);
      },
    ),
  );
  assert.throws(() =>
    feeFor(
      { kind: "quadratic", rate: "0.07", appliesTo: "both", rounding: cents() },
      {
        price: 101,
        quantity: 1,
        quantityScale: 0,
        currencyScale: 2,
        liquidity: "taker",
      },
    ),
  );
});

test("composite fees are the sum of their parts, line by line", () => {
  const schedule: FeeSchedule[] = [
    {
      source: "venue",
      label: "Venue trading fee",
      model: {
        kind: "quadratic",
        rate: "0.07",
        appliesTo: "both",
        rounding: cents(),
      },
    },
    {
      source: "app",
      label: "App · 0.5%",
      model: { kind: "bps", bps: 50, appliesTo: "both", rounding: cents() },
    },
  ];
  const fill = {
    price: 63,
    quantity: 153,
    quantityScale: 0,
    currencyScale: 2,
    liquidity: "taker" as const,
  };
  const lines = computeFees(schedule, fill);
  assert.deepEqual(
    lines.map((l) => l.label),
    ["Venue trading fee", "App · 0.5%"],
  );
  const both = feeFor(
    { kind: "composite", parts: schedule.map((s) => s.model) },
    fill,
  );
  assert.equal(both, lines[0].amount + lines[1].amount);
});

// ------------------------------------------------------------------ quotes
const CENTS_MARKET: QuoteMarket = {
  quantityScale: 0,
  quantityStep: 1,
  currencyScale: 2,
};

const askBook = fc
  .uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 6 })
  .chain((prices) =>
    fc.tuple(
      fc.constant([...prices].sort((a, b) => a - b)),
      fc.array(fc.integer({ min: 1, max: 400 }), {
        minLength: prices.length,
        maxLength: prices.length,
      }),
    ),
  )
  .map(([prices, sizes]) =>
    prices.map((price, i) => ({ price, quantity: sizes[i] })),
  );

const schedule = fc.array(
  fc.record({
    source: fc.constant("venue" as const),
    label: fc.string({ minLength: 1, maxLength: 8 }),
    model: feeModel,
  }),
  { maxLength: 2 },
);

test("a budget buy never overspends, fills in book order and stops only for a reason", () => {
  fc.assert(
    fc.property(
      askBook,
      fc.integer({ min: 0, max: 60_000 }),
      schedule,
      (asks, budget, fees) => {
        const sched = fees;
        const q = quoteFromBook(
          asks,
          { side: "buy", budget },
          sched,
          CENTS_MARKET,
        );
        assert.ok(q.total <= budget, `total ${q.total} > budget ${budget}`);
        assert.equal(
          q.quantity,
          q.fills.reduce((s, f) => s + f.quantity, 0),
        );
        q.fills.forEach((fill, i) => {
          assert.equal(fill.price, asks[i].price);
          assert.ok(fill.quantity <= asks[i].quantity);
        });
        if (q.limitedBy === "depth")
          q.fills.forEach((fill, i) =>
            assert.equal(fill.quantity, asks[i].quantity),
          );
        assert.equal(q.total, q.notional + q.feeTotal);
      },
    ),
    { numRuns: 400 },
  );
});

test("more budget never buys fewer shares", () => {
  fc.assert(
    fc.property(
      askBook,
      fc.integer({ min: 0, max: 40_000 }),
      fc.integer({ min: 0, max: 20_000 }),
      (asks, a, extra) => {
        const noFees: FeeSchedule[] = [];
        const small = quoteFromBook(
          asks,
          { side: "buy", budget: a },
          noFees,
          CENTS_MARKET,
        );
        const large = quoteFromBook(
          asks,
          { side: "buy", budget: a + extra },
          noFees,
          CENTS_MARKET,
        );
        return large.quantity >= small.quantity;
      },
    ),
  );
});

test("limits and slippage caps are never crossed", () => {
  fc.assert(
    fc.property(
      askBook,
      fc.integer({ min: 1, max: 99 }),
      fc.integer({ min: 0, max: 20 }),
      (asks, limit, slip) => {
        const q = quoteFromBook(
          asks,
          {
            side: "buy",
            quantity: 10_000,
            limitPrice: limit,
            maxSlippage: slip,
          },
          [],
          CENTS_MARKET,
        );
        for (const fill of q.fills) {
          assert.ok(fill.price <= limit);
          assert.ok(fill.price - asks[0].price <= slip);
        }
      },
    ),
  );
});

test("a sell walks the bids down and pays fees out of the proceeds", () => {
  const bids = [
    { price: 61, quantity: 100 },
    { price: 60, quantity: 200 },
    { price: 58, quantity: 300 },
  ];
  const fees: FeeSchedule[] = [
    {
      source: "app",
      label: "App",
      model: { kind: "bps", bps: 50, appliesTo: "both", rounding: cents() },
    },
  ];
  const q = quoteFromBook(
    bids,
    { side: "sell", quantity: 250, maxSlippage: 2 },
    fees,
    CENTS_MARKET,
  );
  assert.deepEqual(
    q.fills.map((f) => [f.price, f.quantity]),
    [
      [61, 100],
      [60, 150],
    ],
  );
  assert.equal(q.notional, 61 * 100 + 60 * 150);
  assert.equal(q.total, q.notional - q.feeTotal);
  assert.ok(q.complete);
  const capped = quoteFromBook(
    bids,
    { side: "sell", quantity: 600, maxSlippage: 2 },
    fees,
    CENTS_MARKET,
  );
  assert.equal(capped.limitedBy, "slippage");
  assert.equal(capped.quantity, 300);
  assert.throws(
    () =>
      quoteFromBook(
        [...bids].reverse(),
        { side: "sell", quantity: 1 },
        [],
        CENTS_MARKET,
      ),
    /ordered/,
  );
});

test("fractional venues quote in share units and round cost up", () => {
  const market: QuoteMarket = {
    quantityScale: 2,
    quantityStep: 1,
    currencyScale: 6,
  };
  const q = quoteFromBook(
    [{ price: 333_333, quantity: 150 }],
    { side: "buy", quantity: 150 },
    [],
    market,
  );
  assert.equal(q.notional, 500_000); // 1.50 × $0.333333 = $0.4999995 → up
  const s = quoteFromBook(
    [{ price: 333_333, quantity: 150 }],
    { side: "sell", quantity: 150 },
    [],
    market,
  );
  assert.equal(s.notional, 499_999);
});

// --------------------------------------------------------------- lifecycle
test("the lifecycle only moves where venues really move", () => {
  assert.ok(canTransition("open", "paused") && canTransition("paused", "open"));
  assert.ok(
    canTransition("closed", "open"),
    "a close time moved into the future",
  );
  assert.ok(
    canTransition("determined", "disputed") &&
      canTransition("disputed", "determined"),
  );
  assert.ok(
    canTransition("open", "resolved"),
    "a missed message may skip ahead",
  );
  assert.ok(!canTransition("determined", "open"));
  assert.ok(!canTransition("open", "upcoming"));
  for (const final of ["resolved", "voided", "delisted"] as const)
    for (const to of MARKET_STATUSES)
      assert.equal(canTransition(final, to), to === final);
  fc.assert(
    fc.property(
      fc.constantFrom(...MARKET_STATUSES),
      (s: MarketStatus) =>
        isFinal(s) ||
        (canTransition(s, "unknown") && canTransition("unknown", s)),
    ),
  );
});

test("bids-only books complement into asks, and malformed books are caught", () => {
  const noBids = [
    { price: 40, quantity: 5 },
    { price: 38, quantity: 7 },
  ];
  assert.deepEqual(complementLevels(noBids, 100), [
    { price: 60, quantity: 5 },
    { price: 62, quantity: 7 },
  ]);
  assert.ok(
    isWellFormed({
      outcome: "yes",
      bids: [{ price: 59, quantity: 1 }],
      asks: complementLevels(noBids, 100),
    }),
  );
  assert.ok(
    !isWellFormed({
      outcome: "yes",
      bids: [{ price: 61, quantity: 1 }],
      asks: [{ price: 60, quantity: 1 }],
    }),
  );
  assert.ok(
    !isWellFormed({
      outcome: "yes",
      bids: [{ price: 50, quantity: 0 }],
      asks: [],
    }),
  );
  const binary = {
    type: "binary" as const,
    outcomes: [
      { key: "yes", label: "Yes", index: 0 },
      { key: "no", label: "No", index: 1 },
    ],
  };
  assert.equal(yesNo(binary).no.label, "No");
  assert.throws(() => yesNo({ type: "categorical", outcomes: [] }));
});

test("illustrated avatars: drawn, recognised, and handed out evenly and for good", () => {
  assert.equal(new Set(AVATAR_PRESET_IDS).size, AVATAR_PRESETS.length, "ids are unique");
  for (const id of AVATAR_PRESET_IDS) {
    assert.equal(presetOf(presetUrl(id)), id);
    assert.ok(existsSync(join(__dirname, "../../../apps/web/public", presetUrl(id))), `${id} is drawn (npm run avatars -w @imo/web)`);
  }
  assert.equal(presetOf("https://elsewhere.example/avatars/lorelei-01.svg"), null, "only our own files");
  assert.equal(presetOf("/avatars/lorelei-99.svg"), null, "only listed presets");
  assert.equal(presetOf("/memory-storage/avatars/u1/photo.png"), null, "a photo is a photo");
  assert.equal(presetOf(null), null);

  const id = "0b9d7c3e-2f1a-4c8e-9a51-3d2c1b0a9f87";
  assert.equal(defaultAvatar(id), defaultAvatar(id), "the same person, the same face");
  assert.ok(presetOf(defaultAvatar(id)));
  const handedOut = new Set(Array.from({ length: 2_000 }, (_, n) => defaultAvatar(`user-${n}`)));
  assert.equal(handedOut.size, AVATAR_PRESETS.length, "every illustration gets worn");
});
