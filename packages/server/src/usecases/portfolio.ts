/**
 * The paper portfolio: balances, positions valued at what they'd sell for
 * now (the executable bid), resting orders, closed positions and activity —
 * all read back from the ledger and the fills, never kept on the client.
 * Settlement, claims and season resets live here too.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { signedUsd, usd } from "../dto/format";
import { cents } from "../dto/money";
import { conflict, invalid, notFound } from "../errors";
import { appendEvent } from "../outbox";
import { cancelResting } from "./trading";
import type { Viewer } from "./viewer";

const ONE = 1_000_000;
export const RESET_COOLDOWN_DAYS = 30;

const positionId = (slug: string, outcome: string) => `${slug}:${outcome}`;
const outcomeName = (key: string) => (key === "yes" ? ("Yes" as const) : ("No" as const));

/** What one share sells for now: the Yes bid, or for No, 1 − the Yes ask. */
export function bidFor(outcome: string, quote: typeof t.marketQuotes.$inferSelect | null, market: typeof t.markets.$inferSelect) {
  if (market.resolution?.final) {
    const won = market.resolution.outcome === outcome;
    return market.resolution.outcome === "void" ? ONE / 2 : won ? ONE : 0;
  }
  if (!quote) return 0;
  if (outcome === "yes") return quote.yesBid ?? quote.last ?? 0;
  return quote.yesAsk !== null ? ONE - quote.yesAsk : quote.last !== null ? ONE - quote.last : 0;
}

/**
 * With wallet trading, `wallet` is the trader's USDC onchain (null when the
 * chain couldn't be read): cash is what the wallet holds, not a ledger sum.
 */
export async function getPortfolio(db: Db, viewer: Viewer, now = new Date(), wallet?: { cash: number | null }) {
  const [account] = await db.select().from(t.tradingAccounts).where(eq(t.tradingAccounts.id, viewer.accountId));
  if (!account) throw notFound("Your paper account");

  const held = await db
    .select({ position: t.positions, market: t.markets, quote: t.marketQuotes })
    .from(t.positions)
    .innerJoin(t.markets, eq(t.markets.id, t.positions.marketId))
    .leftJoin(t.marketQuotes, eq(t.marketQuotes.marketId, t.markets.id))
    .where(eq(t.positions.accountId, account.id))
    .orderBy(desc(t.positions.updatedAt));

  const buyFills = held.length
    ? await db
        .select()
        .from(t.fills)
        .where(and(eq(t.fills.accountId, account.id), eq(t.fills.side, "buy"), inArray(t.fills.marketId, held.map((h) => h.market.id))))
        .orderBy(t.fills.createdAt)
    : [];

  let positionsValue = 0;
  let basis = 0;
  const positions = held.map(({ position, market, quote }) => {
    const unit = 10 ** market.quantityScale;
    const bid = bidFor(position.outcome, quote, market);
    const value = Math.floor((position.quantity * bid) / unit);
    positionsValue += value;
    basis += position.cost + position.fees;
    return {
      id: positionId(market.slug, position.outcome),
      marketId: market.slug,
      outcome: outcomeName(position.outcome),
      shares: position.quantity / unit,
      costCents: cents(position.cost),
      feeCents: cents(position.fees),
      valueCents: cents(value),
      bidCents: cents(bid),
      unrealizedCents: cents(value - position.cost - position.fees),
      fills: buyFills
        .filter((f) => f.marketId === market.id && f.outcome === position.outcome)
        .map((f) => ({
          id: f.id,
          at: f.createdAt.toISOString(),
          side: "Buy" as const,
          shares: f.quantity / unit,
          priceCents: cents(f.price),
          feeCents: cents(f.feeTotal),
        })),
    };
  });

  const closed = await db
    .select({ row: t.realizedPnl, slug: t.markets.slug, scale: t.markets.quantityScale })
    .from(t.realizedPnl)
    .innerJoin(t.markets, eq(t.markets.id, t.realizedPnl.marketId))
    .where(eq(t.realizedPnl.accountId, account.id))
    .orderBy(desc(t.realizedPnl.closedAt))
    .limit(100);

  const claims = await db
    .select({ claim: t.claims, slug: t.markets.slug, scale: t.markets.quantityScale })
    .from(t.claims)
    .innerJoin(t.markets, eq(t.markets.id, t.claims.marketId))
    .where(and(eq(t.claims.accountId, account.id), eq(t.claims.status, "claimable")));

  const cash = wallet ? (wallet.cash ?? 0) : account.cash;
  const total = cash + positionsValue;
  return {
    account: {
      /** "wallet": real USDC onchain; "paper": the simulated balance. */
      kind: wallet ? ("wallet" as const) : ("paper" as const),
      /** False when the wallet's balance couldn't be read just now. */
      cashKnown: !wallet || wallet.cash !== null,
      cashCents: cents(cash),
      reservedCents: cents(wallet ? 0 : account.reserved),
      availableCents: cents(wallet ? cash : account.cash - account.reserved),
      positionsValueCents: cents(positionsValue),
      totalCents: cents(total),
      unrealizedCents: cents(positionsValue - basis),
      startingBalanceCents: cents(account.startingBalance),
      // A wallet has no starting balance of ours: its return is on what's held.
      returnPct: wallet
        ? basis > 0 ? Math.round(((positionsValue - basis) / basis) * 10_000) / 100 : 0
        : Math.round(((total - account.startingBalance) / account.startingBalance) * 10_000) / 100,
      season: account.season,
      /** When a new season may start; null once it may. */
      nextResetAt:
        account.lastResetAt &&
        account.lastResetAt.getTime() + RESET_COOLDOWN_DAYS * 86_400_000 > now.getTime()
          ? new Date(account.lastResetAt.getTime() + RESET_COOLDOWN_DAYS * 86_400_000).toISOString()
          : null,
    },
    positions,
    closed: closed.map(({ row, slug, scale }) => ({
      id: row.id,
      marketId: slug,
      outcome: outcomeName(row.outcome),
      kind: row.kind,
      shares: row.quantity / 10 ** scale,
      costCents: cents(row.cost),
      feeCents: cents(row.entryFees),
      proceedsCents: cents(row.proceeds),
      exitFeeCents: cents(row.exitFees),
      pnlCents: cents(row.pnl),
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt.toISOString(),
    })),
    claims: claims.map(({ claim, slug, scale }) => ({
      id: claim.id,
      positionId: positionId(slug, claim.outcome),
      marketId: slug,
      outcome: outcomeName(claim.outcome),
      shares: claim.quantity / 10 ** scale,
      payoutCents: cents(claim.payout),
    })),
  };
}

/**
 * The activity rail, newest first: money in and out (grouped by what caused
 * it), plus what holds or moves nothing yet — cash held for resting orders,
 * orders that found no liquidity, results waiting to be claimed.
 */
export async function getActivity(db: Db, viewer: Viewer, limit = 50) {
  const rows = await db
    .select({
      refId: t.ledgerEntries.refId,
      refType: t.ledgerEntries.refType,
      kind: sql<string>`min(${t.ledgerEntries.kind})`,
      amount: sql<number>`sum(${t.ledgerEntries.amount})::bigint`,
      fees: sql<number>`coalesce(sum(case when ${t.ledgerEntries.kind} in ('venue_fee', 'app_fee', 'rounding_fee') then -${t.ledgerEntries.amount} else 0 end), 0)::bigint`,
      at: sql<Date>`max(${t.ledgerEntries.createdAt})`,
      memo: sql<string | null>`max(${t.ledgerEntries.memo})`,
    })
    .from(t.ledgerEntries)
    .where(eq(t.ledgerEntries.accountId, viewer.accountId))
    .groupBy(t.ledgerEntries.refId, t.ledgerEntries.refType, sql`case when ${t.ledgerEntries.refId} is null then ${t.ledgerEntries.id} end`)
    .orderBy(sql`max(${t.ledgerEntries.createdAt}) desc`)
    .limit(limit);
  const orderIds = rows.filter((r) => r.refType === "order" && r.refId).map((r) => r.refId!);
  const orders = orderIds.length
    ? await db
        .select({
          id: t.orders.id,
          side: t.orders.side,
          outcome: t.orders.outcome,
          filled: t.orders.filledQuantity,
          quantity: t.orders.quantity,
          avg: t.orders.averagePrice,
          title: t.markets.shortTitle,
          scale: t.markets.quantityScale,
          realized: sql<number | null>`(select sum(r.pnl) from realized_pnl r where r.order_id = ${t.orders.id})::bigint`,
        })
        .from(t.orders)
        .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
        .where(inArray(t.orders.id, orderIds))
    : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  const claimIds = rows.filter((r) => r.refType === "claim" && r.refId).map((r) => r.refId!);
  const paid = claimIds.length
    ? await db
        .select({ id: t.claims.id, outcome: t.claims.outcome, quantity: t.claims.quantity, scale: t.markets.quantityScale })
        .from(t.claims)
        .innerJoin(t.markets, eq(t.markets.id, t.claims.marketId))
        .where(inArray(t.claims.id, claimIds))
    : [];
  const claimOf = new Map(paid.map((c) => [c.id, c]));

  type Item = { id: string; kind: "buy" | "sell" | "claim" | "order"; title: string; detail: string; amountCents: number; at: string };
  const items: Item[] = rows.map((r, i) => {
    const amount = Number(r.amount);
    const fees = Number(r.fees);
    const order = r.refId ? byId.get(r.refId) : undefined;
    const at = new Date(r.at).toISOString();
    if (order) {
      const unit = 10 ** order.scale;
      const shares = order.filled / unit;
      const price = order.avg !== null ? `${cents(order.avg)}¢` : "";
      const outcome = outcomeName(order.outcome);
      if (order.side === "sell")
        return {
          id: order.id,
          kind: "sell",
          title: `Sold ${outcome} · ${order.title}`,
          detail: `${shares} shares at ${price}${order.realized !== null ? ` · realized ${signedUsd(Number(order.realized))}` : ` · ${usd(fees)} in fees`}`,
          amountCents: cents(amount),
          at,
        };
      const partial = order.quantity !== null && order.filled < order.quantity;
      return {
        id: order.id,
        kind: "buy",
        title: `${partial ? "Partial fill" : `Bought ${outcome}`} · ${order.title}`,
        detail: partial
          ? `${shares} / ${order.quantity! / unit} ${outcome} at ${price} · ${usd(fees)} in fees`
          : `${shares} shares at ${price} · ${usd(fees)} in fees`,
        amountCents: cents(amount),
        at,
      };
    }
    const claim = r.refId ? claimOf.get(r.refId) : undefined;
    const titled: Record<string, [string, string]> = {
      settlement: [`Claimed payout · ${r.memo ?? "resolved market"}`, claim ? `${claim.quantity / 10 ** claim.scale} ${outcomeName(claim.outcome)} × $1.00 · paid to cash` : "Paid to cash"],
      deposit: ["Paper account funded", "Starting balance · simulated funds"],
      reset: ["Season reset", r.memo ?? "Balance back to the start"],
      adjustment: ["Balance adjustment", r.memo ?? ""],
    };
    const [title, detail] = titled[r.kind] ?? ["Adjustment", r.memo ?? ""];
    return { id: r.refId ?? `ledger-${i}-${at}`, kind: r.kind === "settlement" ? "claim" : r.kind === "deposit" ? "claim" : "order", title, detail, amountCents: cents(amount), at };
  });

  // What holds or moves nothing yet.
  const [resting, failed, claimable] = await Promise.all([
    db
      .select({ order: t.orders, title: t.markets.shortTitle, scale: t.markets.quantityScale })
      .from(t.orders)
      .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
      .where(and(eq(t.orders.accountId, viewer.accountId), inArray(t.orders.status, ["open", "partial"]))),
    db
      .select({ order: t.orders, title: t.markets.shortTitle })
      .from(t.orders)
      .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
      .where(and(eq(t.orders.accountId, viewer.accountId), eq(t.orders.status, "failed")))
      .orderBy(desc(t.orders.createdAt))
      .limit(20),
    db
      .select({ claim: t.claims, title: t.markets.shortTitle, scale: t.markets.quantityScale })
      .from(t.claims)
      .innerJoin(t.markets, eq(t.markets.id, t.claims.marketId))
      .where(and(eq(t.claims.accountId, viewer.accountId), eq(t.claims.status, "claimable"))),
  ]);
  for (const { order, title, scale } of resting) {
    const unit = 10 ** scale;
    const remaining = ((order.quantity ?? 0) - order.filledQuantity) / unit;
    const limitCents = order.limitPrice !== null ? cents(order.limitPrice) : 0;
    const buy = order.side === "buy";
    items.push({
      id: `hold-${order.id}`,
      kind: "order",
      title: `Limit placed · ${title}`,
      detail: `${buy ? "Buy" : "Sell"} ${remaining} ${outcomeName(order.outcome)} at ${limitCents}¢ · ${buy ? `${usd(order.reserved)} reserved` : "shares held"}`,
      amountCents: buy ? -cents(order.reserved) : 0,
      at: order.createdAt.toISOString(),
    });
  }
  for (const { order, title } of failed)
    items.push({
      id: `failed-${order.id}`,
      kind: "order",
      title: `Order failed · ${title}`,
      detail: "No liquidity at market · no funds used",
      amountCents: 0,
      at: order.createdAt.toISOString(),
    });
  for (const { claim, title, scale } of claimable)
    items.push({
      id: `claimable-${claim.id}`,
      kind: "claim",
      title: `Resolved ${outcomeName(claim.outcome)} · ${title}`,
      detail: `${claim.quantity / 10 ** scale} ${outcomeName(claim.outcome)} · ${usd(claim.payout)} claimable`,
      amountCents: 0,
      at: claim.createdAt.toISOString(),
    });
  return { items: items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit) };
}

export async function getPosition(db: Db, viewer: Viewer, id: string) {
  const portfolio = await getPortfolio(db, viewer);
  const position = portfolio.positions.find((p) => p.id === id);
  if (!position) throw notFound("That position");
  return { position, claim: portfolio.claims.find((c) => c.positionId === id) ?? null };
}

/**
 * Pay out a market once its result is final. Exactly once: the settlements
 * row is the guard. Winners get a claim; losing and void-zero positions close
 * at their realized result; resting orders in the market are cancelled.
 */
export async function settleMarket(db: Db, marketId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [market] = await tx.select().from(t.markets).where(eq(t.markets.id, marketId)).for("update");
    if (!market?.resolution?.final) return { settled: false, reason: "not final" };
    const claimed = await tx
      .insert(t.settlements)
      .values({ marketId, outcome: market.resolution.outcome, settledAt: now })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) return { settled: false, reason: "already settled" };

    const resting = await tx
      .select()
      .from(t.orders)
      .where(and(eq(t.orders.marketId, marketId), inArray(t.orders.status, ["open", "partial"])))
      .for("update");
    await cancelResting(tx, resting, "The market resolved.", now);

    const positions = await tx.select().from(t.positions).where(eq(t.positions.marketId, marketId));
    const unit = 10 ** market.quantityScale;
    let claims = 0;
    for (const p of positions) {
      const perShare = market.resolution.outcome === "void" ? ONE / 2 : market.resolution.outcome === p.outcome ? ONE : 0;
      const payout = Math.floor((p.quantity * perShare) / unit);
      if (payout > 0) {
        await tx
          .insert(t.claims)
          .values({ accountId: p.accountId, marketId, outcome: p.outcome, quantity: p.quantity, payout, status: "claimable", createdAt: now })
          .onConflictDoNothing();
        claims++;
      } else {
        await tx.insert(t.realizedPnl).values({
          accountId: p.accountId,
          marketId,
          outcome: p.outcome,
          kind: "settlement",
          quantity: p.quantity,
          proceeds: 0,
          cost: p.cost,
          entryFees: p.fees,
          exitFees: 0,
          pnl: -(p.cost + p.fees),
          openedAt: p.openedAt,
          closedAt: now,
        });
        await tx
          .delete(t.positions)
          .where(and(eq(t.positions.accountId, p.accountId), eq(t.positions.marketId, marketId), eq(t.positions.outcome, p.outcome)));
      }
      await appendEvent(tx, "position.settled", `market:${marketId}`, {
        accountId: p.accountId,
        marketId,
        outcome: p.outcome,
        result: market.resolution.outcome,
        shares: p.quantity / unit,
        basis: p.cost + p.fees,
        payout,
      });
    }
    return { settled: true, claims, closed: positions.length - claims, cancelled: resting.length };
  });
}

async function lock(tx: Tx, viewer: Viewer) {
  const [account] = await tx.select().from(t.tradingAccounts).where(eq(t.tradingAccounts.id, viewer.accountId)).for("update");
  if (!account) throw notFound("Your paper account");
  return account;
}

export async function claimPosition(db: Db, viewer: Viewer, id: string, now: Date) {
  return recordClaim(db, viewer, id, now, { onchain: false });
}

/**
 * Book a payout: the ledger line, realized P&L, the position closed and the
 * claim marked paid. Paper moves the cash; an onchain claim already moved it
 * in the trader's wallet, and may land before our own settlement ran, so it
 * books from the position when there's no claim row yet.
 */
export async function recordClaim(db: Db, viewer: Viewer, id: string, now: Date, options: { onchain: boolean }) {
  const [slug, outcome] = id.split(":");
  const receipt = await db.transaction(async (tx) => {
    const account = await lock(tx, viewer);
    const [market] = await tx.select().from(t.markets).where(eq(t.markets.slug, slug ?? "")).limit(1);
    if (!market) throw notFound("A payout for that position");
    const [claim] = await tx
      .select()
      .from(t.claims)
      .where(and(eq(t.claims.accountId, account.id), eq(t.claims.marketId, market.id), eq(t.claims.outcome, outcome ?? "")))
      .for("update");
    if (claim?.status === "claimed") {
      if (options.onchain) return { title: market.shortTitle, payoutCents: cents(claim.payout), profitCents: 0, cashCents: null };
      throw conflict("already_claimed", "That payout was already claimed.");
    }
    const [position] = await tx
      .select()
      .from(t.positions)
      .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome ?? "")));
    if (!claim && !(options.onchain && position)) throw notFound("A payout for that position");
    // A winning share pays one dollar.
    const payout = claim?.payout ?? Math.floor((position!.quantity * ONE) / 10 ** market.quantityScale);
    const quantity = claim?.quantity ?? position!.quantity;
    const [paid] = claim
      ? await tx.update(t.claims).set({ status: "claimed", claimedAt: now }).where(eq(t.claims.id, claim.id)).returning()
      : await tx
          .insert(t.claims)
          .values({ accountId: account.id, marketId: market.id, outcome: outcome!, quantity, payout, status: "claimed", claimedAt: now, createdAt: now })
          .returning();
    await tx.insert(t.ledgerEntries).values({
      accountId: account.id,
      amount: payout,
      currency: account.currency,
      kind: "settlement",
      refType: "claim",
      refId: paid!.id,
      memo: market.shortTitle,
      createdAt: now,
    });
    const cost = position?.cost ?? 0;
    const fees = position?.fees ?? 0;
    await tx.insert(t.realizedPnl).values({
      accountId: account.id,
      marketId: market.id,
      outcome: outcome!,
      kind: "settlement",
      quantity,
      proceeds: payout,
      cost,
      entryFees: fees,
      exitFees: 0,
      pnl: payout - cost - fees,
      openedAt: position?.openedAt ?? now,
      closedAt: now,
    });
    if (position)
      await tx
        .delete(t.positions)
        .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome!)));
    // Onchain, the money is already in the wallet; paper moves it here.
    if (!options.onchain)
      await tx.update(t.tradingAccounts).set({ cash: account.cash + payout }).where(eq(t.tradingAccounts.id, account.id));
    else
      await tx.insert(t.ledgerEntries).values({
        accountId: account.id,
        amount: -payout,
        currency: account.currency,
        kind: "adjustment",
        refType: "claim",
        refId: paid!.id,
        memo: `To your wallet · ${market.shortTitle}`,
        createdAt: now,
      });
    await appendEvent(tx, "claim.paid", `user:${viewer.userId}`, { userId: viewer.userId, payout, market: market.slug });
    return {
      title: market.shortTitle,
      payoutCents: cents(payout),
      profitCents: cents(payout - cost - fees),
      cashCents: options.onchain ? null : cents(account.cash + payout),
    };
  });
  return receipt;
}

/** A new season: positions and resting orders are cleared, cash returns to
    the starting balance. Once per 30 days, so resets can't farm rankings. */
export async function resetAccount(db: Db, viewer: Viewer, now: Date) {
  return db.transaction(async (tx) => {
    const account = await lock(tx, viewer);
    if (account.lastResetAt && now.getTime() - account.lastResetAt.getTime() < RESET_COOLDOWN_DAYS * 86_400_000)
      throw invalid(`You can reset once every ${RESET_COOLDOWN_DAYS} days.`, {
        nextResetAt: new Date(account.lastResetAt.getTime() + RESET_COOLDOWN_DAYS * 86_400_000).toISOString(),
      });
    const resting = await tx
      .select()
      .from(t.orders)
      .where(and(eq(t.orders.accountId, account.id), inArray(t.orders.status, ["open", "partial"])))
      .for("update");
    await cancelResting(tx, resting, "Season reset", now);
    await tx.delete(t.positions).where(eq(t.positions.accountId, account.id));
    await tx.delete(t.claims).where(and(eq(t.claims.accountId, account.id), eq(t.claims.status, "claimable")));
    await tx.insert(t.accountResets).values({ accountId: account.id, season: account.season, equityBefore: account.cash, createdAt: now });
    await tx.insert(t.ledgerEntries).values({
      accountId: account.id,
      amount: account.startingBalance - account.cash,
      currency: account.currency,
      kind: "reset",
      memo: `Season ${account.season + 1}`,
      createdAt: now,
    });
    await tx
      .update(t.tradingAccounts)
      .set({ cash: account.startingBalance, reserved: 0, season: account.season + 1, lastResetAt: now })
      .where(eq(t.tradingAccounts.id, account.id));
    await appendEvent(tx, "account.reset", `user:${viewer.userId}`, { userId: viewer.userId, season: account.season + 1 });
    return { season: account.season + 1, cashCents: cents(account.startingBalance) };
  });
}
