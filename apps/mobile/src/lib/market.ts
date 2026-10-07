/**
 * Prices a person can act on, by the web app's rules (src/domain/engine.ts,
 * src/domain/money.ts): buy at the live ask, mark open positions to the live
 * bid, and a resolved market pays 100¢ to the winning side, 0 to the other.
 * No's ask is 100 − Yes's bid, and No's bid is 100 − Yes's ask.
 */
import type { MarketDTO } from "@imo/server/dto/api-types";

export type Outcome = "Yes" | "No";

export const complement = (cents: number) => Math.round((100 - cents) * 100) / 100;

export function priceFor(market: MarketDTO, outcome: Outcome) {
  if (market.status === "resolved") return market.resolution.outcome === outcome ? 100 : 0;
  return outcome === "Yes" ? market.yesPrice : complement(market.yesPrice);
}

/** The best price to sell at (what an open position is worth now). */
export function bestBid(market: MarketDTO, outcome: Outcome) {
  if (market.status !== "open") return priceFor(market, outcome);
  const live = outcome === "Yes" ? market.yesBid : market.yesAsk != null ? complement(market.yesAsk) : null;
  return live ?? priceFor(market, outcome);
}

/** The best price to buy at. */
export function bestAsk(market: MarketDTO, outcome: Outcome) {
  if (market.status !== "open") return priceFor(market, outcome);
  const live = outcome === "Yes" ? market.yesAsk : market.yesBid != null ? complement(market.yesBid) : null;
  return live ?? priceFor(market, outcome);
}

export const opposite = (outcome: Outcome): Outcome => (outcome === "Yes" ? "No" : "Yes");
