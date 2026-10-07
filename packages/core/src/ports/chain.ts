/**
 * The chain, as the platform uses it: what a trader's wallet holds, a recent
 * blockhash to build on, and relaying transactions the trader already signed.
 * The platform never signs or holds funds.
 */
export interface WalletBalance {
  /** Native SOL, in lamports (1e9 = 1 SOL): pays network fees. */
  lamports: number;
  /** Token balances in base units, by mint. */
  tokens: Record<string, number>;
}

export interface ChainReader {
  balances(owner: string, mints: readonly string[]): Promise<WalletBalance>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** Relay a signed transaction (base64); resolves to its signature. */
  send(signedTransaction: string): Promise<string>;
  /** Where a transaction stands: null until the network has seen it. */
  status(signature: string): Promise<{ confirmed: boolean; error: string | null } | null>;
}
