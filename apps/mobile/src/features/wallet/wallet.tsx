/**
 * The trader's wallet on this device: Privy's embedded Solana wallet, unlocked
 * with their imo (Supabase) session — no second sign-in. Screens ask for
 * `useWallet()` and call `sign(transaction)` on what the API built; the key
 * never leaves Privy's secure enclave and never reaches our server.
 *
 * Expo Go can't load the wallet's native modules: there the wallet reports
 * itself unavailable and trading screens say why, instead of crashing.
 */
import Constants, { ExecutionEnvironment } from "expo-constants";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { useConfig } from "~/features/auth/auth";
import { getAccessToken, loadSession } from "~/lib/session";

export type WalletState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "error"; reason: string }
  | { status: "ready"; address: string; sign: (transaction: string) => Promise<string> };

const WalletContext = createContext<WalletState>({ status: "loading" });

export const useWallet = () => useContext(WalletContext);

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Loaded only where its native modules exist (a dev or store build); a static
// import would crash Expo Go at startup.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const privy = inExpoGo ? null : (require("@privy-io/expo") as typeof import("@privy-io/expo"));

/** Privy unlocks the wallet with the imo session's access token. */
async function sessionToken() {
  const session = await loadSession();
  if (session?.kind !== "supabase") return undefined;
  return (await getAccessToken()) ?? undefined;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useConfig().data;
  const unavailable = (reason: string): WalletState => ({ status: "unavailable", reason });

  if (!privy) return <WalletContext.Provider value={unavailable("Trading needs the imo app. Expo Go can't sign transactions.")}>{children}</WalletContext.Provider>;
  if (!config) return <WalletContext.Provider value={{ status: "loading" }}>{children}</WalletContext.Provider>;
  if (config.trading !== "wallet")
    return <WalletContext.Provider value={unavailable("This server trades paper money.")}>{children}</WalletContext.Provider>;
  if (!config.privy?.mobileClientId)
    return <WalletContext.Provider value={unavailable("Wallet signing isn't set up on this server yet.")}>{children}</WalletContext.Provider>;

  const { PrivyProvider } = privy;
  return (
    <PrivyProvider
      appId={config.privy.appId}
      clientId={config.privy.mobileClientId}
      config={{ customAuth: { enabled: true, isLoading: false, getCustomAccessToken: sessionToken } }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

/** Privy's state, as the app's WalletState. */
function Bridge({ children }: { children: ReactNode }) {
  const { isReady } = privy!.usePrivy();
  const solana = privy!.useEmbeddedSolanaWallet();
  const wallet = "wallets" in solana ? solana.wallets?.[0] : undefined;

  const sign = useCallback(
    async (transaction: string) => {
      if (!wallet) throw new Error("Your wallet isn't ready yet.");
      const provider = await wallet.getProvider();
      const { signedTransaction } = await provider.request({
        method: "signTransaction",
        params: { transaction: Uint8Array.from(Buffer.from(transaction, "base64")) },
      });
      return Buffer.from(signedTransaction as Uint8Array).toString("base64");
    },
    [wallet],
  );

  const value = useMemo<WalletState>(() => {
    if (!isReady) return { status: "loading" };
    switch (solana.status) {
      case "connected":
        return wallet ? { status: "ready", address: wallet.address, sign } : { status: "loading" };
      case "connecting":
      case "reconnecting":
      case "creating":
        return { status: "loading" };
      case "needs-recovery":
        return { status: "error", reason: "Your wallet needs to be recovered before it can sign." };
      case "not-created":
        return { status: "error", reason: "No wallet is linked to this account yet." };
      case "disconnected":
        return { status: "error", reason: "Your wallet is disconnected. Sign in again to reconnect it." };
      default:
        return { status: "error", reason: "Your wallet couldn't connect. Try again in a moment." };
    }
  }, [isReady, solana.status, wallet, sign]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
