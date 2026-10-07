/** Prices are cents and may be fractional (62.5¢); whole cents drop the decimal. */
export const price = (cents: number) => `${Number.isInteger(cents) ? cents : cents.toFixed(1)}¢`;

export const count = (n: number) =>
  n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n / 1000)}k`;

/** "now", "6m", "3h", "2d", then a date. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole dollars from cents, with separators: 1000000 → "$10,000". */
export const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Dollars from cents, with separators and cents: 1842055 → "$18,420.55". */
export const usd = (cents: number) =>
  `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "+$48.00", "−$16.00", "$0.00". */
export const signedUsd = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${usd(cents)}`;

/** A gain or loss with its arrow: "▲ +$48.00", "▼ −$16.00". */
export const arrowUsd = (cents: number) => (cents === 0 ? usd(0) : `${cents > 0 ? "▲" : "▼"} ${signedUsd(cents)}`);
