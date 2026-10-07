/**
 * Money in the core: integer minor units of a registered currency.
 *
 * Amounts are JS numbers that hold integers. They stay exact up to
 * Number.MAX_SAFE_INTEGER (about 9 × 10^15 — some $9B at micro-dollar
 * scale). Anything finer, like an 18-decimal token, is converted to its
 * currency's scale at the adapter edge. Products that could overflow are
 * computed in bigint and rounded back with an explicit mode, so no float
 * ever touches a balance.
 */

/**
 * - `ceil` rounds toward +∞, `floor` toward −∞, `trunc` toward zero.
 * - `half-up` rounds to nearest, with ties away from zero.
 * - `half-even` rounds to nearest, with ties to even (banker's rounding).
 */
export type RoundingMode = "ceil" | "floor" | "trunc" | "half-up" | "half-even";

export interface Currency {
  /** ISO 4217 code or token symbol, upper case: "USD", "USDC". */
  code: string;
  /** Decimals kept in the ledger: USD at 6 means micro-dollars. */
  scale: number;
  /** Decimals shown by default. */
  displayDecimals: number;
  symbol?: string;
}

const currencies = new Map<string, Currency>();

/** Register a currency. Adapters register the collateral they settle in. */
export function defineCurrency(definition: Currency): Currency {
  const { code, scale, displayDecimals } = definition;
  if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code))
    throw new RangeError(`Currency code must be upper case: ${code}`);
  if (!Number.isInteger(scale) || scale < 0 || scale > 9)
    throw new RangeError(`${code}: scale must be 0–9, got ${scale}`);
  if (
    !Number.isInteger(displayDecimals) ||
    displayDecimals < 0 ||
    displayDecimals > scale
  )
    throw new RangeError(`${code}: display decimals must be 0–${scale}`);
  const existing = currencies.get(code);
  if (existing) {
    if (
      existing.scale !== scale ||
      existing.displayDecimals !== displayDecimals
    )
      throw new Error(`${code} is already defined with another scale`);
    return existing;
  }
  const frozen = Object.freeze({ ...definition });
  currencies.set(code, frozen);
  return frozen;
}

export function currency(code: string): Currency {
  const found = currencies.get(code);
  if (!found) throw new RangeError(`Unknown currency: ${code}`);
  return found;
}

export const USD = defineCurrency({
  code: "USD",
  scale: 6,
  displayDecimals: 2,
  symbol: "$",
});

export interface Money {
  /** Integer minor units of `currency`. */
  readonly amount: number;
  readonly currency: string;
}

export function assertUnits(value: number, what = "amount"): number {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${what} must be a safe integer, got ${value}`);
  return value;
}

export function money(amount: number, code: string = USD.code): Money {
  currency(code);
  return Object.freeze({ amount: assertUnits(amount), currency: code });
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency)
    throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

export const add = (a: Money, b: Money): Money => {
  same(a, b);
  return money(a.amount + b.amount, a.currency);
};
export const subtract = (a: Money, b: Money): Money => {
  same(a, b);
  return money(a.amount - b.amount, a.currency);
};
export const negate = (a: Money): Money => money(-a.amount, a.currency);
export const compare = (a: Money, b: Money): -1 | 0 | 1 => {
  same(a, b);
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
};
export const sum = (items: readonly Money[], code: string): Money =>
  items.reduce((total, item) => add(total, item), money(0, code));

/** Divide with an explicit rounding mode. The denominator must be non-zero. */
export function divRound(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new RangeError("Division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  const negative = n < 0n;
  switch (mode) {
    case "trunc":
      return q;
    case "floor":
      return negative ? q - 1n : q;
    case "ceil":
      return negative ? q : q + 1n;
    case "half-up":
    case "half-even": {
      const twice = (negative ? -r : r) * 2n;
      const away = negative ? q - 1n : q + 1n;
      if (twice > d) return away;
      if (twice < d) return q;
      if (mode === "half-up") return away;
      return q % 2n === 0n ? q : away;
    }
  }
}

function toSafe(value: bigint, what: string): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError(`${what} overflows a safe integer`);
  return Number(value);
}

/** a × b ÷ c with one rounding step, exact in between. */
export function mulDiv(
  a: number | bigint,
  b: number | bigint,
  c: number | bigint,
  mode: RoundingMode,
): number {
  return toSafe(divRound(BigInt(a) * BigInt(b), BigInt(c), mode), "mulDiv");
}

/** Round to a multiple of `step` (e.g. 10,000 micro-dollars = one cent). */
export function roundToStep(
  units: number,
  step: number,
  mode: RoundingMode,
): number {
  assertUnits(units);
  if (!Number.isSafeInteger(step) || step <= 0)
    throw new RangeError(`Step must be a positive integer, got ${step}`);
  return toSafe(
    divRound(BigInt(units), BigInt(step), mode) * BigInt(step),
    "roundToStep",
  );
}

/** Move an integer amount between scales, e.g. cents (2) → micros (6). */
export function rescale(
  units: number,
  fromScale: number,
  toScale: number,
  mode: RoundingMode,
): number {
  assertUnits(units);
  if (toScale >= fromScale)
    return toSafe(
      BigInt(units) * 10n ** BigInt(toScale - fromScale),
      "rescale",
    );
  return toSafe(
    divRound(BigInt(units), 10n ** BigInt(fromScale - toScale), mode),
    "rescale",
  );
}

export const pow10 = (exponent: number): number => {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 15)
    throw new RangeError(`10^${exponent} is out of range`);
  return 10 ** exponent;
};

/** A decimal string as an exact fraction: "0.07" → 7/100. */
export function ratio(text: string): { num: bigint; den: bigint } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new RangeError(`Not a decimal: ${text}`);
  const [, sign, whole, fraction = ""] = match;
  const den = 10n ** BigInt(fraction.length);
  const num = BigInt(whole + fraction) * (sign ? -1n : 1n);
  return { num, den };
}

/**
 * Parse a decimal string into integer units at `scale` — "0.4200" at scale 6 is
 * 420000. More digits than the scale allows need a rounding mode; otherwise the
 * value is rejected rather than silently rounded.
 */
export function parseUnits(
  text: string,
  scale: number,
  mode?: RoundingMode,
): number {
  const { num, den } = ratio(text);
  const scaled = num * 10n ** BigInt(scale);
  if (scaled % den !== 0n && !mode)
    throw new RangeError(`${text} has more than ${scale} decimals`);
  return toSafe(divRound(scaled, den, mode ?? "trunc"), `parseUnits(${text})`);
}

/** Integer units at `scale` as a plain decimal string: 420000 @6 → "0.42". */
export function formatUnits(units: number, scale: number, minDecimals = 0) {
  assertUnits(units);
  const negative = units < 0;
  const digits = String(Math.abs(units)).padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  let fraction = scale ? digits.slice(digits.length - scale) : "";
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < minDecimals)
    fraction = fraction.padEnd(minDecimals, "0");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
