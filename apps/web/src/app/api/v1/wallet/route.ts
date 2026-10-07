import { route } from "@imo/server/http/route";
import { walletInfo } from "@imo/server/usecases/wallet-trading";

/** The trader's wallet: its address (to deposit to) and balances onchain. */
export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => walletInfo(deps, deps.db, viewer),
});
