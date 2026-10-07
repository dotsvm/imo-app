/**
 * Accounts, the ledger, orders, fills, positions, settlement. Paper and live
 * trading share every table: an account belongs to an execution route, and
 * the route decides where orders go.
 *
 * The ledger is append-only (a trigger forbids UPDATE and DELETE): balances on
 * trading_accounts are a cache of it, rebuilt and checked nightly.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FeeLine } from "@imo/core/fees";
import { createdAt, id, oneOf, ref, units, updatedAt, when } from "./columns";
import { users } from "./identity";
import { markets } from "./markets";
import { executionRoutes } from "./registry";

export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routeId: text()
      .notNull()
      .references(() => executionRoutes.id),
    currency: text().notNull(),
    /** Cached from the ledger: spendable, and held for resting orders. */
    cash: units().notNull(),
    reserved: units().notNull().default(0),
    startingBalance: units().notNull(),
    /** Resets start a new season; stats only compare within a season. */
    season: integer().notNull().default(1),
    lastResetAt: when(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("trading_accounts_user_route").on(t.userId, t.routeId),
    check(
      "trading_accounts_cash",
      sql`${t.cash} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.cash}`,
    ),
  ],
);

export const LEDGER_KINDS = [
  "deposit",
  "reset",
  "buy",
  "sell",
  "venue_fee",
  "app_fee",
  "rounding_fee",
  "reserve",
  "release",
  "settlement",
  /** A correction or a seeded balance: always with a memo saying why. */
  "adjustment",
] as const;

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    /** Signed minor units: negative leaves the account. Reserve and release
        move cash between available and reserved, and sum to zero over time. */
    amount: units().notNull(),
    currency: text().notNull(),
    kind: text({ enum: LEDGER_KINDS }).notNull(),
    refType: text(),
    refId: ref(),
    memo: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_account_time").on(t.accountId, t.createdAt),
    index("ledger_ref").on(t.refType, t.refId),
    check("ledger_kind", oneOf("kind", LEDGER_KINDS)),
  ],
);

export const ORDER_STATUSES = [
  "pending",
  "open",
  "partial",
  "filled",
  "cancelled",
  "rejected",
  "failed",
  "expired",
] as const;

export const orders = pgTable(
  "orders",
  {
    id: id(),
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routeId: text()
      .notNull()
      .references(() => executionRoutes.id),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    side: text({ enum: ["buy", "sell"] }).notNull(),
    type: text({ enum: ["market", "limit"] }).notNull(),
    timeInForce: text({ enum: ["ioc", "fok", "gtc", "gtd"] }).notNull(),
    limitPrice: units(),
    /** Share units requested (sells, and buys by quantity). */
    quantity: units(),
    /** Cash to spend, fees included (buys by amount). */
    budget: units(),
    filledQuantity: units().notNull().default(0),
    averagePrice: units(),
    /** Cash held for the unfilled part of a resting buy (or shares, for sells). */
    reserved: units().notNull().default(0),
    status: text({ enum: ORDER_STATUSES }).notNull(),
    reason: text(),
    /** The preview the user confirmed: price, fees and totals as shown. */
    quote: jsonb().$type<Record<string, unknown>>(),
    /** Placed from a prediction's Back or Fade drawer. */
    postId: ref(),
    clientOrderId: text().notNull(),
    venueOrderId: text(),
    /** Wallet orders: the venue position the order adds to or reduces. */
    venuePositionId: text(),
    /** Wallet orders: the signature of the transaction that placed it. */
    txSignature: text(),
    /** Wallet orders: when the signed transaction reached the venue. */
    submittedAt: when(),
    expiresAt: when(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_client").on(t.userId, t.clientOrderId),
    index("orders_account_status").on(t.accountId, t.status),
    index("orders_resting")
      .on(t.marketId, t.outcome)
      .where(sql`status in ('open', 'partial')`),
    index("orders_in_flight")
      .on(t.submittedAt)
      .where(sql`status = 'pending' and venue_order_id is not null`),
    check("orders_status", oneOf("status", ORDER_STATUSES)),
    check("orders_side", oneOf("side", ["buy", "sell"])),
    check("orders_type", oneOf("type", ["market", "limit"])),
    check(
      "orders_amount",
      sql`${t.quantity} is not null or ${t.budget} is not null`,
    ),
  ],
);

export const fills = pgTable(
  "fills",
  {
    id: id(),
    orderId: ref()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    side: text({ enum: ["buy", "sell"] }).notNull(),
    price: units().notNull(),
    quantity: units().notNull(),
    notional: units().notNull(),
    fees: jsonb().$type<FeeLine[]>().notNull(),
    feeTotal: units().notNull(),
    liquidity: text({ enum: ["taker", "maker"] }).notNull(),
    /** The top of the book the fill was priced against, for audits and disputes. */
    book: jsonb().$type<{ price: number; quantity: number }[]>(),
    /** Wallet fills: the venue's id for the fill, so it's mirrored once. */
    venueFillId: text(),
    /** Wallet fills: the onchain signature. */
    txSignature: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("fills_account_time").on(t.accountId, t.createdAt),
    uniqueIndex("fills_venue_fill").on(t.venueFillId),
    index("fills_order").on(t.orderId),
    check(
      "fills_positive",
      sql`${t.quantity} > 0 and ${t.price} >= 0 and ${t.feeTotal} >= 0`,
    ),
  ],
);

export const positions = pgTable(
  "positions",
  {
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    quantity: units().notNull(),
    /** What the shares cost, fees excluded, and the fees paid for them. */
    cost: units().notNull(),
    fees: units().notNull(),
    openedAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.marketId, t.outcome] }),
    index("positions_market").on(t.marketId),
    check(
      "positions_nonnegative",
      sql`${t.quantity} >= 0 and ${t.cost} >= 0 and ${t.fees} >= 0`,
    ),
  ],
);

/** A closed slice of a position — sold, or settled. */
export const realizedPnl = pgTable(
  "realized_pnl",
  {
    id: id(),
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    kind: text({ enum: ["sell", "settlement"] }).notNull(),
    quantity: units().notNull(),
    proceeds: units().notNull(),
    cost: units().notNull(),
    entryFees: units().notNull(),
    exitFees: units().notNull(),
    pnl: units().notNull(),
    /** The sell that closed it; null for settlements. */
    orderId: ref(),
    openedAt: when().notNull(),
    closedAt: createdAt(),
  },
  (t) => [index("realized_account_time").on(t.accountId, t.closedAt), index("realized_order").on(t.orderId)],
);

/** One row per market once its final result is paid out — the guard that
    makes settlement run exactly once. */
export const settlements = pgTable("settlements", {
  marketId: ref()
    .primaryKey()
    .references(() => markets.id),
  outcome: text().notNull(),
  settledAt: createdAt(),
});

export const claims = pgTable(
  "claims",
  {
    id: id(),
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    quantity: units().notNull(),
    payout: units().notNull(),
    status: text({ enum: ["claimable", "claimed"] }).notNull(),
    createdAt: createdAt(),
    claimedAt: when(),
  },
  (t) => [
    uniqueIndex("claims_position").on(t.accountId, t.marketId, t.outcome),
    check("claims_status", oneOf("status", ["claimable", "claimed"])),
  ],
);

export const accountResets = pgTable("account_resets", {
  id: id(),
  accountId: ref()
    .notNull()
    .references(() => tradingAccounts.id, { onDelete: "cascade" }),
  season: integer().notNull(),
  equityBefore: units().notNull(),
  createdAt: createdAt(),
});
