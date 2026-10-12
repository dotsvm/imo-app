/**
 * SKR, the Solana Seeker's token, in the trader's wallet: its balance, a swap
 * to USDC (the collateral every market settles in) through Jupiter, and tips
 * to a prediction's author. As with withdrawals, the trader's wallet signs on
 * their device and we relay exactly the transaction we built — never anything
 * else — so the tokens never pass through us.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
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
import { count, eq, sum } from "drizzle-orm";
import { z } from "zod";
import type { ChainReader } from "@imo/core/ports/chain";
import { SKR } from "../catalogs";
import type { Deps } from "../composition";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { cents } from "../dto/money";
import { ApiError, conflict, invalid, unavailable } from "../errors";
import { visiblePost } from "./posts";
import { messageOf, SIGN_WINDOW_MS, walletOf } from "./wallet-trading";
import type { Viewer } from "./viewer";

type SkrDeps = Pick<Deps, "venues" | "chain" | "cache" | "log" | "http" | "secrets" | "rateLimiter">;

/** Jupiter's Swap API: keyed when a key is configured, else its keyless host. */
const SWAP_HOST = { keyed: "https://api.jup.ag/swap/v1", keyless: "https://lite-api.jup.ag/swap/v1" };
/** How far the price may move between the quote and the swap landing. */
const SLIPPAGE_BPS = 100;
/** Network fees, and opening a token account the first time, are paid in SOL. */
const MIN_LAMPORTS = 3_000_000;

const units = (skr: number) => Math.round(skr * 10 ** SKR.decimals);
const whole = (base: number) => base / 10 ** SKR.decimals;

interface Built {
  transaction: string;
  amount: number;
}
interface BuiltSwap extends Built {
  outMicros: number;
}
interface BuiltTip extends Built {
  postId: string;
  toUserId: string;
}

const swapKey = (userId: string) => `skr-swap:${userId}`;
const tipKey = (userId: string) => `skr-tip:${userId}`;

function chainOf(deps: SkrDeps) {
  if (!deps.chain) throw unavailable("SKR isn't available on this server.");
  return deps.chain;
}

function usdcMint(deps: SkrDeps) {
  const c = [...deps.venues.execution.values()][0]?.module.collateral;
  if (!c) throw unavailable("Swaps aren't available on this server.");
  return c.mint;
}

/** The trader's SKR and SOL, checked before anything is built. */
async function fundsFor(chain: ChainReader, owner: string, amount: number) {
  const balance = await chain.balances(owner, [SKR.mint]);
  const held = balance.tokens[SKR.mint] ?? 0;
  if (amount > held) throw new ApiError(422, "insufficient_funds", `You have ${whole(held).toLocaleString("en-US")} SKR.`);
  if (balance.lamports < MIN_LAMPORTS)
    throw new ApiError(422, "needs_sol", "Add about 0.01 SOL to your wallet to pay the network fee.");
}

function amountOf(skr: number) {
  const amount = units(skr);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid("Enter an amount of SKR.");
  return amount;
}

// ─── Swap SKR → USDC ────────────────────────────────────────────────────────

const Quote = z.looseObject({
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  priceImpactPct: z.string().optional(),
});
const Swap = z.looseObject({ swapTransaction: z.string() });

async function jupiter<T>(deps: SkrDeps, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const key = await deps.secrets.get("JUPITER_API_KEY");
  await deps.rateLimiter.acquire("jupiter:trade", 1);
  try {
    const raw = await deps.http.json(`${key ? SWAP_HOST.keyed : SWAP_HOST.keyless}${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: key ? { "x-api-key": key } : undefined,
      idempotent: true,
      timeoutMs: 20_000,
    });
    return schema.parse(raw);
  } catch (error) {
    deps.log.warn("jupiter swap unavailable", { path: path.split("?")[0], error: (error as Error).message });
    throw new ApiError(503, "swap_unavailable", "Swapping is unavailable right now. Try again in a moment.");
  }
}

async function quote(deps: SkrDeps, amount: number) {
  const params = new URLSearchParams({
    inputMint: SKR.mint,
    outputMint: usdcMint(deps),
    amount: String(amount),
    slippageBps: String(SLIPPAGE_BPS),
  });
  return jupiter(deps, `/quote?${params}`, Quote);
}

const quoteDTO = (amount: number, q: z.infer<typeof Quote>) => ({
  skr: whole(amount),
  // Whole cents, rounded down: never promise more than the swap pays.
  usdcCents: Math.floor(cents(Number(q.outAmount))),
  /** The least it can fill for, after slippage. */
  minUsdcCents: Math.floor(cents(Number(q.otherAmountThreshold))),
  priceImpactPct: Number(q.priceImpactPct ?? 0) * 100,
});

/** What an amount of SKR would swap for, right now. Nothing is built. */
export async function quoteSkrSwap(deps: SkrDeps, input: { skr: number }) {
  const amount = amountOf(input.skr);
  return quoteDTO(amount, await quote(deps, amount));
}

/** A Jupiter swap of SKR to USDC, for the trader's wallet to sign. */
export async function buildSkrSwap(deps: SkrDeps, db: Db, viewer: Viewer, input: { skr: number }) {
  const chain = chainOf(deps);
  const owner = await walletOf(db, viewer.userId);
  const amount = amountOf(input.skr);
  await fundsFor(chain, owner, amount);

  const q = await quote(deps, amount);
  const { swapTransaction } = await jupiter(deps, "", Swap, {
    quoteResponse: q,
    userPublicKey: owner,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
  });
  // Jupiter built it, so check it before the trader is asked to sign: their
  // wallet pays the fee and is the only signer, so nothing else can ride along.
  onlySigner(swapTransaction, owner);

  await deps.cache.set<BuiltSwap>(
    swapKey(viewer.userId),
    { transaction: swapTransaction, amount, outMicros: Number(q.outAmount) },
    SIGN_WINDOW_MS / 1000,
  );
  return { transaction: swapTransaction, signers: [owner], ...quoteDTO(amount, q) };
}

/** Relay the signed swap — only the one we built. */
export async function submitSkrSwap(deps: SkrDeps, viewer: Viewer, signed: string) {
  const built = await deps.cache.get<BuiltSwap>(swapKey(viewer.userId));
  if (!built) throw conflict("expired", "That swap expired before it was signed. Nothing was sent — try again.");
  const { signature, status } = await relay(deps, built, signed, swapKey(viewer.userId), "swap");
  return { signature, status, skr: whole(built.amount), usdcCents: Math.floor(cents(built.outMicros)) };
}

// ─── Tips ───────────────────────────────────────────────────────────────────

/** An SKR transfer to a prediction's author, for the tipper's wallet to sign. */
export async function buildTip(deps: SkrDeps, db: Db, viewer: Viewer, postId: string, input: { skr: number }) {
  const chain = chainOf(deps);
  const post = await visiblePost(db, viewer, postId);
  if (post.deletedAt) throw conflict("deleted", "That prediction was deleted.");
  if (post.authorId === viewer.userId) throw invalid("You can't tip your own prediction.");
  const owner = await walletOf(db, viewer.userId);
  const to = await walletOf(db, post.authorId).catch(() => {
    throw new ApiError(409, "no_wallet", "They can't receive tips yet.");
  });
  if (!isAddress(to) || to === owner) throw new ApiError(409, "no_wallet", "They can't receive tips yet.");
  const amount = amountOf(input.skr);
  await fundsFor(chain, owner, amount);

  const from = createNoopSigner(address(owner));
  const mint = address(SKR.mint);
  const [source] = await findAssociatedTokenPda({ owner: address(owner), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: address(to), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const { blockhash, lastValidBlockHeight } = await chain.latestBlockhash();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(from, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          // A no-op when the author already has an SKR account.
          getCreateAssociatedTokenIdempotentInstruction({ payer: from, ata: destination, owner: address(to), mint }),
          getTransferCheckedInstruction({ source, mint, destination, authority: from, amount: BigInt(amount), decimals: SKR.decimals }),
        ],
        m,
      ),
  );
  const transaction = getBase64EncodedWireTransaction(compileTransaction(message));
  await deps.cache.set<BuiltTip>(tipKey(viewer.userId), { transaction, amount, postId, toUserId: post.authorId }, SIGN_WINDOW_MS / 1000);
  return { transaction, signers: [owner], postId, skr: whole(amount) };
}

/** Relay the signed tip — only the one we built for this post — and record it. */
export async function submitTip(deps: SkrDeps, db: Db, viewer: Viewer, postId: string, signed: string) {
  const built = await deps.cache.get<BuiltTip>(tipKey(viewer.userId));
  if (!built || built.postId !== postId)
    throw conflict("expired", "That tip expired before it was signed. Nothing was sent — try again.");
  const { signature, status } = await relay(deps, built, signed, tipKey(viewer.userId), "tip");
  await db
    .insert(t.tips)
    .values({ postId, fromUserId: viewer.userId, toUserId: built.toUserId, amount: built.amount, signature })
    .onConflictDoNothing();
  return { signature, status, skr: whole(built.amount), tips: await tipsOn(db, viewer, postId) };
}

/** How much SKR a prediction has been tipped, and by how many tips. */
export async function tipsOn(db: Db, viewer: Viewer | null, postId: string) {
  await visiblePost(db, viewer, postId);
  const [row] = await db
    .select({ count: count(), amount: sum(t.tips.amount) })
    .from(t.tips)
    .where(eq(t.tips.postId, postId));
  return { count: row?.count ?? 0, skr: whole(Number(row?.amount ?? 0)) };
}

// ─── Shared ─────────────────────────────────────────────────────────────────

/** Refuse a transaction anyone but the owner would sign, or pay for. */
function onlySigner(base64: string, owner: string) {
  let message;
  try {
    message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(base64, "base64")).messageBytes);
  } catch {
    throw new ApiError(502, "swap_unavailable", "Jupiter sent a swap we couldn't read. Nothing was sent.");
  }
  if (message.staticAccounts[0] !== owner || message.header.numSignerAccounts !== 1)
    throw new ApiError(502, "swap_unavailable", "Jupiter's swap needed another signer, so it was refused. Nothing was sent.");
}

/** Land the signed bytes if they're the message we built, then wait briefly. */
async function relay(deps: SkrDeps, built: Built, signed: string, key: string, what: "swap" | "tip") {
  const chain = chainOf(deps);
  if (!Buffer.from(messageOf(signed)).equals(Buffer.from(messageOf(built.transaction))))
    throw invalid(`The signed transaction doesn't match this ${what}.`);
  let signature: string;
  try {
    signature = await chain.send(signed);
  } catch (error) {
    deps.log.warn(`skr ${what} not sent`, { error: (error as Error).message });
    throw new ApiError(409, "not_sent", `Solana didn't accept the ${what}. Nothing was sent — try again.`);
  }
  await deps.cache.delete(key);
  // Confirmation usually takes a second or two.
  for (let i = 0; i < 12; i++) {
    const s = await chain.status(signature).catch(() => null);
    if (s?.error) throw new ApiError(409, "failed", `The ${what} failed onchain. Nothing was sent.`);
    if (s?.confirmed) return { signature, status: "confirmed" as const };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { signature, status: "sent" as const };
}
