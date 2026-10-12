/**
 * How this server trades, for the trade screens: real money from the wallet
 * (its USDC onchain, the venue's minimum, and the signer) or paper.
 */
import { useQuery } from "@tanstack/react-query";
import type { WalletDTO } from "@imo/server/dto/api-types";
import { useConfig } from "~/features/auth/auth";
import { useMe } from "~/features/auth/use-account";
import { api } from "~/lib/api";
import { useWallet } from "./wallet";

export function useTrading() {
  const config = useConfig().data;
  const live = config?.trading === "wallet";
  const me = useMe().data;
  const wallet = useWallet();
  const info = useQuery({
    queryKey: ["wallet"],
    queryFn: ({ signal }) => api<WalletDTO>("/wallet", { signal }),
    enabled: live,
    staleTime: 15_000,
  });
  return {
    live,
    wallet,
    info: info.data,
    /** Cents to spend: the wallet's USDC, or paper cash. Null while loading; 0 once loaded with no balance. */
    availableCents: live ? (info.data ? (info.data.balance?.usdcCents ?? 0) : null) : (me?.account.availableCents ?? null),
    minOrderCents: live ? (config?.wallet?.minOrderCents ?? 500) : 100,
    refresh: () => info.refetch(),
  };
}
