/**
 * Whether a market can be traded here. With real money only the venues the
 * server executes on (/config → wallet.venues) take orders; data-only venues
 * are shown but not traded. A paper server trades every venue it shows.
 * Unknown until /config answers: nothing is tradable before then.
 */
import { useConfig } from "~/features/auth/auth";

export function useTradable() {
  const config = useConfig().data;
  return (venueId: string) => {
    if (!config) return false;
    if (config.trading !== "wallet") return true;
    return (config.wallet?.venues ?? []).includes(venueId);
  };
}

/** Whether to offer a trade on this market right now: open, not paused, and on a venue that takes orders here. */
export function useCanTrade() {
  const tradable = useTradable();
  return (market: { status: string; paused?: boolean; venueId: string }) =>
    market.status === "open" && !market.paused && tradable(market.venueId);
}
