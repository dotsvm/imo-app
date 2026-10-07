/**
 * Fees as data. A venue, a route or the app describes its fee as a model, and
 * one pure evaluator prices every fill. A new venue with a new fee shape adds a
 * model kind here once; the ticket just renders the lines it gets back.
 */
import { divRound, pow10, ratio, type RoundingMode } from "./money";

export type FeeLiquidity = "taker" | "maker";
/** Which side of a fill pays: takers, makers (some Kalshi series), or both. */
export type FeeAppliesTo = FeeLiquidity | "both";

const applies = (appliesTo: FeeAppliesTo, liquidity: FeeLiquidity) =>
  appliesTo === "both" || appliesTo === liquidity;

export interface FeeRounding {
  mode: RoundingMode;
  /**
   * Decimals of the currency unit to round to: 6 is $0.000001 (Kalshi's
   * trade fee), 2 is a cent. Independent of the scale the fee is evaluated
   * at, so one model means the same thing in cents or in micro-dollars.
   */
  decimals: number;
}

export type FeeModel =
  | { kind: "none" }
  /** rate × shares × p × (1 − p): Kalshi's trading fee, Polymarket's taker fee. */
  | {
      kind: "quadratic";
      rate: string;
      appliesTo: FeeAppliesTo;
      rounding: FeeRounding;
    }
  /** A flat share of notional, in basis points: the app fee, builder fees. */
  | {
      kind: "bps";
      bps: number;
      appliesTo: FeeAppliesTo;
      rounding: FeeRounding;
    }
  /** Several fees charged together, rounded one by one. */
  | { kind: "composite"; parts: readonly FeeModel[] };

export interface FeeFill {
  /** Price per whole share, in minor units of the collateral. */
  price: number;
  /** Shares, in units of 10^-quantityScale. */
  quantity: number;
  quantityScale: number;
  /** The collateral's scale: a winning share pays 10^currencyScale units. */
  currencyScale: number;
  liquidity: FeeLiquidity;
}

export type FeeSource = "venue" | "app" | "route" | "network" | "rounding";

/** A fee as the ticket names it: "Kalshi trading fee", "Hunch · 0.5%". */
export interface FeeSchedule {
  source: FeeSource;
  label: string;
  model: FeeModel;
}

export interface FeeLine {
  source: FeeSource;
  label: string;
  /** Minor units, never negative. */
  amount: number;
}

function check(fill: FeeFill) {
  const { price, quantity, quantityScale, currencyScale } = fill;
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new RangeError(
      `Quantity must be a non-negative integer: ${quantity}`,
    );
  if (!Number.isSafeInteger(price) || price < 0)
    throw new RangeError(`Price must be a non-negative integer: ${price}`);
  pow10(quantityScale);
  pow10(currencyScale);
}

/** Round num/den (minor units at `scale`) to the model's decimals. Finer
    decimals than the scale can hold round at the scale itself. */
function rounded(
  num: bigint,
  den: bigint,
  rounding: FeeRounding,
  scale: number,
): number {
  if (!Number.isInteger(rounding.decimals) || rounding.decimals < 0)
    throw new RangeError(`Fee decimals must be a non-negative integer`);
  const step = BigInt(pow10(Math.max(0, scale - rounding.decimals)));
  return Number(divRound(num, den * step, rounding.mode) * step);
}

/** One model's fee for one fill, in minor units. */
export function feeFor(model: FeeModel, fill: FeeFill): number {
  check(fill);
  switch (model.kind) {
    case "none":
      return 0;
    case "composite":
      return model.parts.reduce((total, part) => total + feeFor(part, fill), 0);
    case "quadratic": {
      if (!applies(model.appliesTo, fill.liquidity)) return 0;
      const one = BigInt(pow10(fill.currencyScale));
      const price = BigInt(fill.price);
      if (price > one)
        throw new RangeError(`A share can't cost more than it pays out`);
      const rate = ratio(model.rate);
      if (rate.num < 0n)
        throw new RangeError(`Negative fee rate: ${model.rate}`);
      const num = rate.num * BigInt(fill.quantity) * price * (one - price);
      const den = rate.den * BigInt(pow10(fill.quantityScale)) * one;
      return rounded(num, den, model.rounding, fill.currencyScale);
    }
    case "bps": {
      if (!applies(model.appliesTo, fill.liquidity)) return 0;
      if (!Number.isSafeInteger(model.bps) || model.bps < 0)
        throw new RangeError(`Basis points must be a non-negative integer`);
      const num =
        BigInt(model.bps) * BigInt(fill.price) * BigInt(fill.quantity);
      const den = 10_000n * BigInt(pow10(fill.quantityScale));
      return rounded(num, den, model.rounding, fill.currencyScale);
    }
  }
}

/** Every scheduled fee for a fill, in schedule order. Zero lines are kept so a
    ticket can say "no venue fee" rather than hide the row. */
export function computeFees(
  schedule: readonly FeeSchedule[],
  fill: FeeFill,
): FeeLine[] {
  return schedule.map(({ source, label, model }) => ({
    source,
    label,
    amount: feeFor(model, fill),
  }));
}

/** Add the lines of several fills together, keeping one line per label. */
export function mergeFeeLines(groups: readonly FeeLine[][]): FeeLine[] {
  const merged = new Map<string, FeeLine>();
  for (const lines of groups)
    for (const line of lines) {
      const key = `${line.source}\u0000${line.label}`;
      const found = merged.get(key);
      merged.set(
        key,
        found ? { ...found, amount: found.amount + line.amount } : { ...line },
      );
    }
  return [...merged.values()];
}

export const feeTotal = (lines: readonly FeeLine[]): number =>
  lines.reduce((total, line) => total + line.amount, 0);
