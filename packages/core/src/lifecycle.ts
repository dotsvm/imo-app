/**
 * One lifecycle for every market, whatever the venue. Each data source maps
 * its own states onto these; the engine only trades `open` markets and only
 * settles `resolved` ones.
 *
 *   upcoming → open ⇄ paused → closed → determined ⇄ disputed → resolved
 *                                     any non-final → voided | delisted
 */
export const MARKET_STATUSES = [
  "upcoming",
  "open",
  "paused",
  "closed",
  "determined",
  "disputed",
  "resolved",
  "voided",
  "delisted",
  "unknown",
] as const;

export type MarketStatus = (typeof MARKET_STATUSES)[number];

const FINAL = new Set<MarketStatus>(["resolved", "voided", "delisted"]);

/** How far along the lifecycle a state is. Moving forward may skip steps — a
    source can miss a message — but moving back is allowed only where venues
    really do it. */
const STAGE: Record<MarketStatus, number> = {
  upcoming: 0,
  open: 1,
  paused: 1,
  closed: 2,
  determined: 3,
  disputed: 3,
  resolved: 4,
  voided: 4,
  delisted: 4,
  unknown: -1,
};

/** Backward moves venues make: a paused market reopens, a closed market's close
    time moves into the future, a disputed result stands again or is amended. */
const BACKWARD = new Set([
  "paused>open",
  "closed>open",
  "closed>paused",
  "disputed>determined",
]);

export const isFinal = (status: MarketStatus) => FINAL.has(status);
export const isTradable = (status: MarketStatus) => status === "open";
/** Venues keep accepting cancels while trading is paused. */
export const acceptsCancels = (status: MarketStatus) =>
  status === "open" || status === "paused";
/** Payouts run once, on the final result only. */
export const settles = (status: MarketStatus) => status === "resolved";

export function canTransition(from: MarketStatus, to: MarketStatus): boolean {
  if (from === to) return true;
  if (isFinal(from)) return false;
  // An unmapped state is quarantined; any known state may recover from it,
  // and anything may fall into it.
  if (from === "unknown" || to === "unknown") return true;
  if (to === "voided" || to === "delisted") return true;
  if (STAGE[to] > STAGE[from]) return true;
  if (STAGE[to] === STAGE[from])
    return (
      (from === "open" && to === "paused") ||
      (from === "determined" && to === "disputed") ||
      BACKWARD.has(`${from}>${to}`)
    );
  return BACKWARD.has(`${from}>${to}`);
}

/** Apply a reported status, rejecting impossible jumps instead of trusting them. */
export function transition(
  from: MarketStatus,
  to: MarketStatus,
): { ok: true; status: MarketStatus } | { ok: false; reason: string } {
  return canTransition(from, to)
    ? { ok: true, status: to }
    : { ok: false, reason: `${from} → ${to} is not a legal transition` };
}
