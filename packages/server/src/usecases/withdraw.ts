/**
 * Withdrawing USDC from the trader's wallet to an address they name. We
 * build the transfer (opening the recipient's USDC account if it has none);
 * their wallet signs it on their device; we relay exactly that transaction.
 * The money never passes through us.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Deps } from "../composition";
import type { Db } from "../db/client";
import { cents, micros } from "../dto/money";
import { ApiError, conflict, invalid, unavailable } from "../errors";
import { messageOf, SIGN_WINDOW_MS, walletOf } from "./wallet-trading";
import type { Viewer } from "./viewer";

type WithdrawDeps = Pick<Deps, "venues" | "chain" | "cache" | "clock" | "log">;

interface BuiltWithdrawal {
  transaction: string;
  to: string;
  amount: number;
}

const key = (userId: string) => `withdraw:${userId}`;

function collateral(deps: WithdrawDeps) {
  const c = [...deps.venues.execution.values()][0]?.module.collateral;
  if (!c || !deps.chain) throw unavailable("Withdrawals aren't available on this server.");
  return { ...c, chain: deps.chain };
}

/** A USDC transfer for the trader's wallet to sign. */
export async function buildWithdrawal(deps: WithdrawDeps, db: Db, viewer: Viewer, input: { to: string; amountCents: number }) {
  const { mint, decimals, symbol, chain } = collateral(deps);
  const owner = await walletOf(db, viewer.userId);
  const to = input.to.trim();
  if (!isAddress(to)) throw invalid("That isn't a Solana address.");
  if (to === owner) throw invalid("That's your own wallet. Send to a different address.");
  const amount = micros(input.amountCents);
  if (amount <= 0) throw invalid("Enter an amount to withdraw.");

  const balance = await chain.balances(owner, [mint]);
  const held = balance.tokens[mint] ?? 0;
  if (amount > held) throw new ApiError(422, "insufficient_funds", `You have ${(held / 1_000_000).toFixed(2)} ${symbol} to withdraw.`);
  // Network fees (and opening the recipient's account) are paid in SOL.
  if (balance.lamports < 3_000_000)
    throw new ApiError(422, "needs_sol", "Add about 0.01 SOL to your wallet to pay the network fee.");

  const from = createNoopSigner(address(owner));
  const mintAddress = address(mint);
  const [source] = await findAssociatedTokenPda({ owner: address(owner), mint: mintAddress, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: address(to), mint: mintAddress, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const { blockhash, lastValidBlockHeight } = await chain.latestBlockhash();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          // A no-op when the recipient already has a USDC account.
          getCreateAssociatedTokenIdempotentInstruction({ payer: from, ata: destination, owner: address(to), mint: mintAddress }),
          getTransferCheckedInstruction({ source, mint: mintAddress, destination, authority: from, amount: BigInt(amount), decimals }),
        ],
        m,
      ),
  );
  const transaction = getBase64EncodedWireTransaction(compileTransaction(message));
  await deps.cache.set<BuiltWithdrawal>(key(viewer.userId), { transaction, to, amount }, SIGN_WINDOW_MS / 1000);
  return { transaction, signers: [owner], to, amountCents: cents(amount), symbol };
}

/** Relay the signed transfer — only the one we built — and wait briefly for it to confirm. */
export async function submitWithdrawal(deps: WithdrawDeps, viewer: Viewer, signed: string) {
  const { chain } = collateral(deps);
  const built = await deps.cache.get<BuiltWithdrawal>(key(viewer.userId));
  if (!built) throw conflict("expired", "That withdrawal expired before it was signed. Nothing was sent — try again.");
  if (!Buffer.from(messageOf(signed)).equals(Buffer.from(messageOf(built.transaction))))
    throw invalid("The signed transaction doesn't match this withdrawal.");
  let signature: string;
  try {
    signature = await chain.send(signed);
  } catch (error) {
    deps.log.warn("withdrawal not sent", { error: (error as Error).message });
    throw new ApiError(409, "not_sent", "Solana didn't accept the transfer. Nothing was sent — try again.");
  }
  await deps.cache.delete(key(viewer.userId));
  // Confirmation usually takes a second or two.
  for (let i = 0; i < 12; i++) {
    const s = await chain.status(signature).catch(() => null);
    if (s?.error) throw new ApiError(409, "failed", "The transfer failed onchain. Nothing was sent.");
    if (s?.confirmed) return { signature, status: "confirmed" as const, to: built.to, amountCents: cents(built.amount) };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { signature, status: "sent" as const, to: built.to, amountCents: cents(built.amount) };
}
