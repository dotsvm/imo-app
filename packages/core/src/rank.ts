/**
 * Fractional ranks for ordered lists: a new place between two neighbors is a
 * key strictly between theirs, so moving an item rewrites one row, never the
 * list. Keys are base-62 fractions in ASCII order (compare them with byte
 * order — `collate "C"` in Postgres), and never end in the zero digit, so
 * there is always room for another key before any key.
 */
const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // A shared prefix stays; the rest is a midpoint of what follows it.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)];
  // Adjacent digits: take b's first digit if b goes on, else extend a.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + midpoint(a.slice(1), null);
}

/** The next key after `a`, stepping one digit: keys stay short when a list
    only ever grows at the end. */
function append(a: string): string {
  if (!a) return DIGITS[DIGITS.length / 2];
  const i = DIGITS.indexOf(a[0]);
  return i < DIGITS.length - 1 ? DIGITS[i + 1] : a[0] + append(a.slice(1));
}

/** The key just before `b`, stepping one digit down. */
function prepend(b: string): string {
  const i = DIGITS.indexOf(b[0]);
  if (i >= 2) return DIGITS[i - 1];
  // "1…" → "0V"; "0…" → "0" and a key before the rest.
  return ZERO + (i === 1 ? DIGITS[DIGITS.length / 2] : prepend(b.slice(1)));
}

const valid = (key: string) =>
  key.length > 0 &&
  !key.endsWith(ZERO) &&
  [...key].every((c) => DIGITS.includes(c));

/** A key after `before` and before `after`; null means that end is open. */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  if (before !== null && !valid(before))
    throw new RangeError(`Not a rank: ${before}`);
  if (after !== null && !valid(after))
    throw new RangeError(`Not a rank: ${after}`);
  if (before !== null && after !== null && before >= after)
    throw new RangeError(`${before} is not before ${after}`);
  if (before === null) return after === null ? append("") : prepend(after);
  if (after === null) return append(before);
  return midpoint(before, after);
}

/** Byte-order comparison, the order ranks are defined in. */
export const compareRanks = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;

/** The key for putting an item at `index` in a list ordered by rank, the
    item itself excluded. */
export function rankAt(ranks: readonly string[], index: number): string {
  const sorted = [...ranks].sort(compareRanks);
  const i = Math.max(0, Math.min(index, sorted.length));
  return rankBetween(sorted[i - 1] ?? null, sorted[i] ?? null);
}
