/**
 * Privy embedded wallets, created for each person on first sign-in — the
 * pump.fun / Fomo pattern: sign in with Google, and a self-custodial Solana
 * (and EVM) wallet exists. Privy keys the person by our identity subject
 * (JWT-based custom auth pointed at the Supabase JWKS), so the browser can
 * later sign with the same wallets through Privy's SDK.
 *
 * Idempotent: an existing Privy user is looked up first; missing chains get
 * a wallet; nothing is ever created twice.
 */
import { z } from "zod";
import type {
  ExternalIdentity,
  ProvidedWallet,
  WalletChain,
  WalletProvider,
} from "@imo/core/ports/identity";
import { HttpError, type HttpClient } from "@imo/core/ports/runtime";

const LinkedWallet = z.object({
  type: z.literal("wallet"),
  address: z.string(),
  chain_type: z.string(),
  wallet_client_type: z.string().optional(),
  connector_type: z.string().optional(),
});
const PrivyUser = z.object({
  id: z.string(),
  linked_accounts: z.array(z.looseObject({ type: z.string() })),
});
const Lookup = z.union([
  z.object({ user: PrivyUser.nullable().optional() }),
  PrivyUser,
]);

const CHAINS: WalletChain[] = ["solana", "ethereum"];

/** The hosts this adapter calls, for the egress allowlist. */
export const PRIVY_HOSTS = ["auth.privy.io", "api.privy.io"];

export class PrivyWallets implements WalletProvider {
  readonly id = "privy";
  private readonly auth: string;
  constructor(
    private readonly http: HttpClient,
    private readonly appId: string,
    appSecret: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`;
  }

  private headers() {
    return { authorization: this.auth, "privy-app-id": this.appId };
  }

  private embedded(user: z.infer<typeof PrivyUser>): ProvidedWallet[] {
    return user.linked_accounts
      .map((account) => LinkedWallet.safeParse(account))
      .flatMap((parsed) =>
        parsed.success &&
        parsed.data.wallet_client_type === "privy" &&
        (parsed.data.chain_type === "solana" ||
          parsed.data.chain_type === "ethereum")
          ? [
              {
                chain: parsed.data.chain_type as WalletChain,
                address: parsed.data.address,
                custody: "embedded" as const,
              },
            ]
          : [],
      );
  }

  private async find(subject: string) {
    try {
      const body = Lookup.parse(
        await this.http.json(
          "https://auth.privy.io/api/v1/users/custom_auth/id",
          {
            method: "POST",
            headers: this.headers(),
            body: { custom_user_id: subject },
            idempotent: true,
          },
        ),
      );
      return "id" in body ? body : (body.user ?? null);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  async walletsFor(identity: ExternalIdentity): Promise<ProvidedWallet[]> {
    let user = await this.find(identity.subject);
    if (!user) {
      try {
        user = PrivyUser.parse(
          await this.http.json("https://api.privy.io/v1/users", {
            method: "POST",
            headers: this.headers(),
            body: {
              linked_accounts: [
                { type: "custom_auth", custom_user_id: identity.subject },
              ],
              wallets: CHAINS.map((chain_type) => ({ chain_type })),
            },
          }),
        );
      } catch (error) {
        // Another request made them a moment ago (a first sign-in fires
        // several at once): Privy refuses the duplicate; use theirs.
        const made = error instanceof HttpError && error.status === 422 ? await this.find(identity.subject) : null;
        if (!made) throw error;
        user = made;
      }
    }
    const have = this.embedded(user);
    const missing = CHAINS.filter(
      (chain) => !have.some((w) => w.chain === chain),
    );
    if (missing.length) {
      const updated = PrivyUser.parse(
        await this.http.json(
          `https://api.privy.io/v1/users/${encodeURIComponent(user.id)}/wallets`,
          {
            method: "POST",
            headers: this.headers(),
            body: { wallets: missing.map((chain_type) => ({ chain_type })) },
          },
        ),
      );
      return this.embedded(updated);
    }
    return have;
  }
}

/** Local and test stand-in: a deterministic, obviously fake address per
    subject and chain. Never wired in production. */
export class DevWallets implements WalletProvider {
  readonly id = "dev";
  async walletsFor(identity: ExternalIdentity): Promise<ProvidedWallet[]> {
    const hex = Buffer.from(identity.subject)
      .toString("hex")
      .padEnd(40, "0")
      .slice(0, 40);
    return [
      {
        chain: "solana",
        address: `DEV${hex.slice(0, 29)}`,
        custody: "embedded",
      },
      { chain: "ethereum", address: `0x${hex}`, custody: "embedded" },
    ];
  }
}
