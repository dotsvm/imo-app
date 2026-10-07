/**
 * Price an order against a live book: walk the levels best-first, stop at the
 * limit or the slippage cap, and charge each fill its fees. The same function
 * previews a ticket in the browser and decides the fill on the server, so the
 * two can never disagree about arithmetic.
 */
import {
  computeFees,
  feeTotal,
  mergeFeeLines,
  type FeeLine,
  type FeeLiquidity,
  type FeeSchedule,
} from "./fees";
import type { BookLevel } from "./market";
import { mulDiv, pow10 } from "./money";

export interface QuoteMarket {
  /** Share units per whole share: 10^quantityScale. */
  quantityScale: number;
  /** Smallest tradable quantity, in share units. */
  quantityStep: number;
  /** A winning share pays 10^currencyScale minor units. */
  currencyScale: number;
}

interface Limits {
  /** Buy: highest price to pay. Sell: lowest price to accept. */
  limitPrice?: number;
  /** Furthest a fill may land from the best price, in minor units. */
  maxSlippage?: number;
  /** Who the fills are charged as. Orders that take the book are takers
      (the default); a resting order filled at its own price is a maker. */
  liquidity?: FeeLiquidity;
}

export type QuoteRequest =
  | ({ side: "buy"; budget: number } & Limits)
  | ({ side: "buy"; quantity: number } & Limits)
  | ({ side: "sell"; quantity: number } & Limits);

export interface QuoteFill {
  price: number;
  quantity: number;
  notional: number;
  fees: FeeLine[];
}

export interface BookQuote {
  side: "buy" | "sell";
  fills: QuoteFill[];
  /** Share units filled. */
  quantity: number;
  notional: number;
  fees: FeeLine[];
  feeTotal: number;
  /** Buy: cash paid, fees included. Sell: cash received, fees taken out. */
  total: number;
  /** Notional per whole share, rounded to the nearest minor unit. */
  averagePrice?: number;
  bestPrice?: number;
  worstPrice?: number;
  /** Everything asked for fits within the book and the limits. */
  complete: boolean;
  /** What stopped the walk before the request was met. */
  limitedBy?: "depth" | "limit" | "slippage";
}

/** Buys round cost up and sells round proceeds down: rounding never favors the
    trader over the ledger. */
function notionalOf(
  side: "buy" | "sell",
  price: number,
  quantity: number,
  market: QuoteMarket,
) {
  return mulDiv(
    price,
    quantity,
    pow10(market.quantityScale),
    side === "buy" ? "ceil" : "floor",
  );
}

function priceFill(
  side: "buy" | "sell",
  price: number,
  quantity: number,
  market: QuoteMarket,
  schedule: readonly FeeSchedule[],
  liquidity: FeeLiquidity = "taker",
): QuoteFill {
  const notional = notionalOf(side, price, quantity, market);
  const fees = computeFees(schedule, {
    price,
    quantity,
    quantityScale: market.quantityScale,
    currencyScale: market.currencyScale,
    liquidity,
  });
  return { price, quantity, notional, fees };
}

const cashFor = (side: "buy" | "sell", fill: QuoteFill) =>
  side === "buy"
    ? fill.notional + feeTotal(fill.fees)
    : fill.notional - feeTotal(fill.fees);

/** The largest multiple of `step` up to `max` that fits the budget. Cost grows
    with quantity, so a binary search finds it exactly. */
function affordable(
  max: number,
  budget: number,
  cost: (quantity: number) => number,
  step: number,
): number {
  let lo = 0;
  let hi = Math.floor(max / step);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cost(mid * step) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo * step;
}

/**
 * `levels` is the side being taken: asks (lowest first) for a buy, bids
 * (highest first) for a sell.
 */
export function quoteFromBook(
  levels: readonly BookLevel[],
  request: QuoteRequest,
  schedule: readonly FeeSchedule[],
  market: QuoteMarket,
): BookQuote {
  const { side } = request;
  const step = market.quantityStep;
  if (!Number.isSafeInteger(step) || step <= 0)
    throw new RangeError("quantityStep must be a positive integer");
  const budget = "budget" in request ? request.budget : undefined;
  const wanted = "quantity" in request ? request.quantity : undefined;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 0))
    throw new RangeError("Budget must be a non-negative integer");
  if (wanted !== undefined && (!Number.isSafeInteger(wanted) || wanted < 0))
    throw new RangeError("Quantity must be a non-negative integer");

  const better = (a: number, b: number) => (side === "buy" ? a < b : a > b);
  // Check the whole book first: a bad level deep in the book is still bad
  // data, even when a small order would never reach it.
  levels.forEach((level, i) => {
    if (
      !Number.isSafeInteger(level.price) ||
      !Number.isSafeInteger(level.quantity) ||
      level.quantity <= 0
    )
      throw new RangeError(
        "Book levels need integer prices and positive quantities",
      );
    if (i > 0 && !better(levels[i - 1].price, level.price))
      throw new RangeError("Book levels must be ordered best first");
  });
  const best = levels[0]?.price;
  const fills: QuoteFill[] = [];
  let spent = 0;
  let filled = 0;
  let limitedBy: BookQuote["limitedBy"];
  let budgetBound = false;

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (
      request.limitPrice !== undefined &&
      better(request.limitPrice, level.price)
    ) {
      limitedBy = "limit";
      break;
    }
    if (
      request.maxSlippage !== undefined &&
      Math.abs(level.price - best!) > request.maxSlippage
    ) {
      limitedBy = "slippage";
      break;
    }
    let take: number;
    if (budget !== undefined) {
      const room = budget - spent;
      take = affordable(
        level.quantity,
        room,
        (q) =>
          cashFor(
            side,
            priceFill(side, level.price, q, market, schedule, request.liquidity),
          ),
        step,
      );
      // A smaller buy fits here, but the next step doesn't: the budget is spent.
      if (take < level.quantity - (level.quantity % step)) budgetBound = true;
    } else {
      const remaining = wanted! - filled;
      take = Math.min(remaining, level.quantity);
      take -= take % step;
    }
    if (take > 0) {
      const fill = priceFill(
        side,
        level.price,
        take,
        market,
        schedule,
        request.liquidity,
      );
      fills.push(fill);
      spent += cashFor(side, fill);
      filled += take;
    }
    if (budgetBound || (wanted !== undefined && filled >= wanted)) break;
  }

  const met =
    budget !== undefined
      ? budgetBound || spent === budget
      : wanted !== undefined && filled >= wanted;
  if (!met && !limitedBy) limitedBy = "depth";

  const notional = fills.reduce((total, fill) => total + fill.notional, 0);
  const fees = mergeFeeLines(fills.map((fill) => fill.fees));
  const totalFees = feeTotal(fees);
  return {
    side,
    fills,
    quantity: filled,
    notional,
    fees,
    feeTotal: totalFees,
    total: side === "buy" ? notional + totalFees : notional - totalFees,
    averagePrice: filled
      ? mulDiv(notional, pow10(market.quantityScale), filled, "half-up")
      : undefined,
    bestPrice: fills[0]?.price,
    worstPrice: fills.at(-1)?.price,
    complete: met,
    limitedBy: met ? undefined : limitedBy,
  };
}
