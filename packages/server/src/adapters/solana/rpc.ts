/**
 * Solana JSON-RPC, read-only: SOL and SPL token balances for a wallet. Any
 * provider's endpoint works (SOLANA_RPC_URL); the public one is rate-limited.
 */
import { z } from "zod";
import type { ChainReader, WalletBalance } from "@imo/core/ports/chain";
import type { HttpClient, RateLimiter } from "@imo/core/ports/runtime";

const Rpc = <T extends z.ZodType>(result: T) =>
  z.object({ result: result.optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });

const Balance = Rpc(z.object({ value: z.number() }));
const TokenAccounts = Rpc(
  z.object({
    value: z.array(
      z.object({
        account: z.object({
          data: z.object({
            parsed: z.object({ info: z.object({ tokenAmount: z.object({ amount: z.string() }) }) }),
          }),
        }),
      }),
    ),
  }),
);

const Blockhash = Rpc(z.object({ value: z.object({ blockhash: z.string(), lastValidBlockHeight: z.number() }) }));
const Sent = Rpc(z.string());
const Statuses = Rpc(
  z.object({
    value: z.array(
      z.object({ confirmationStatus: z.string().nullable().optional(), err: z.unknown().nullable() }).nullable(),
    ),
  }),
);

/** A base58 Solana address: 32–44 characters, no 0/O/I/l. */
export const isSolanaAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export class SolanaRpc implements ChainReader {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string,
    private readonly limiter?: RateLimiter,
  ) {}

  private async rpc<T extends z.ZodType>(method: string, params: unknown[], schema: T) {
    await this.limiter?.acquire("solana:rpc", 1);
    const raw = await this.http.json(this.url, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method, params },
      idempotent: true,
      timeoutMs: 10_000,
    });
    const parsed = schema.parse(raw) as { result?: unknown; error?: { message: string } };
    if (parsed.error) throw new Error(`Solana RPC ${method}: ${parsed.error.message}`);
    return parsed.result;
  }

  async balances(owner: string, mints: readonly string[]): Promise<WalletBalance> {
    if (!isSolanaAddress(owner)) throw new Error("Not a Solana address");
    const [sol, ...tokens] = await Promise.all([
      this.rpc("getBalance", [owner, { commitment: "confirmed" }], Balance),
      ...mints.map((mint) =>
        this.rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }], TokenAccounts),
      ),
    ]);
    return {
      lamports: (sol as { value: number } | undefined)?.value ?? 0,
      tokens: Object.fromEntries(
        mints.map((mint, i) => {
          const accounts = (tokens[i] as z.infer<typeof TokenAccounts>["result"])?.value ?? [];
          return [mint, accounts.reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.amount), 0)];
        }),
      ),
    };
  }

  async latestBlockhash() {
    const result = (await this.rpc("getLatestBlockhash", [{ commitment: "confirmed" }], Blockhash)) as {
      value: { blockhash: string; lastValidBlockHeight: number };
    };
    return result.value;
  }

  async send(signedTransaction: string) {
    // Not idempotent in the HTTP sense, but a resend of the same signed
    // bytes can't land twice: the signature is the transaction's identity.
    return (await this.rpc(
      "sendTransaction",
      [signedTransaction, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }],
      Sent,
    )) as string;
  }

  async status(signature: string) {
    const result = (await this.rpc("getSignatureStatuses", [[signature]], Statuses)) as {
      value: ({ confirmationStatus?: string | null; err: unknown } | null)[];
    };
    const s = result.value[0];
    if (!s) return null;
    return {
      confirmed: s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized",
      error: s.err ? JSON.stringify(s.err) : null,
    };
  }
}
