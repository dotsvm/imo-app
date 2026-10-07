/**
 * The execution port: how the platform trades on a venue with the trader's
 * own wallet. The venue builds an unsigned transaction, the trader's wallet
 * signs it on their device, and the venue carries it out. The platform never
 * holds keys or funds; it relays signed transactions and mirrors the fills.
 *
 * Amounts are micro-units of the collateral (1e6 = $1). Quantities are in
 * units of 10^market.quantityScale contracts, as everywhere else.
 */
import type { ExternalRef, VenueId } from "@imo/core/market";
import type { AdapterContext } from "./source";

export type Outcome = "yes" | "no";

/** A transaction for the trader's wallet to sign. */
export interface UnsignedTransaction {
  /** Base64 wire bytes. */
  transaction: string;
  /** The blockhash it was built on; it can't land after this height. */
  blockhash: string;
  lastValidBlockHeight: number;
  /** Who must sign: the trader's address, nobody else's key. */
  signers: string[];
  /** Venue data to hand back unchanged when submitting. */
  context?: unknown;
}

export interface FeeEstimate {
  venue: number;
  protocol: number;
  total: number;
}

export interface OrderTicket {
  tx: UnsignedTransaction;
  /** The venue's id for the order: what status checks ask about. */
  orderId: string;
  /** The position this order adds to or reduces. */
  positionId: string;
  estimate: {
    /** Contracts the order is expected to fill. */
    quantity: number;
    /** What the trader pays (buy) or receives (sell), before fees. */
    notional: number;
    /** Average price per whole contract. */
    price: number;
    fees: FeeEstimate;
    /** What the position pays if it wins, after this order. */
    payoutIfWins: number;
    slippageBps?: number;
  };
}

export type OrderRequest =
  | { side: "buy"; owner: string; ref: ExternalRef; outcome: Outcome; amount: number }
  | { side: "sell"; owner: string; ref: ExternalRef; outcome: Outcome; positionId: string; quantity: number | "all" };

export interface VenueFill {
  /** Unique per fill at the venue, for idempotent mirroring. */
  id: string;
  at: string;
  /** Average price per whole contract. */
  price: number;
  quantity: number;
  notional: number;
  fee: number;
  signature?: string;
}

export type VenueOrderState = "submitted" | "open" | "partial" | "filled" | "failed" | "unknown";

export interface VenueOrderStatus {
  state: VenueOrderState;
  /** Done: no more fills will come. */
  final: boolean;
  fills: VenueFill[];
  reason?: string;
}

export interface WalletPosition {
  id: string;
  ref: ExternalRef;
  outcome: Outcome;
  quantity: number;
  /** Total paid for what's held. */
  cost: number;
  avgPrice: number;
  /** What it would sell for now, when the market trades. */
  value?: number;
  markPrice?: number;
  fees: number;
  realizedPnl: number;
  /** Pays out if this outcome wins. */
  payout: number;
  claimable: boolean;
  claimed: boolean;
  claimedAmount: number;
  openOrders: number;
  openedAt?: string;
}

export interface ClaimTicket {
  tx: UnsignedTransaction;
  positionId: string;
  payout: number;
}

export interface SubmitResult {
  signature: string;
}

/** Why a venue said no, in terms the trader can act on. */
export type RejectionCode =
  | "min_order"
  | "insufficient_funds"
  | "no_liquidity"
  | "market_closed"
  | "not_settled"
  | "not_found"
  | "trading_paused"
  | "region_blocked"
  | "rejected";

export class VenueRejection extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
    readonly venueCode?: string,
  ) {
    super(message);
    this.name = "VenueRejection";
  }
}

export interface ExecutionVenue {
  /** Smallest buy the venue accepts, in collateral micro-units. */
  readonly minOrder: number;
  buildOrder(request: OrderRequest): Promise<OrderTicket>;
  /** Hand a signed transaction to the venue to land. */
  submit(signedTransaction: string, built: UnsignedTransaction): Promise<SubmitResult>;
  orderStatus(orderId: string, owner: string): Promise<VenueOrderStatus>;
  positions(owner: string): Promise<WalletPosition[]>;
  buildClaim(positionId: string, owner: string): Promise<ClaimTicket>;
}

export interface ExecutionModule {
  id: string;
  venues: VenueId[];
  /** Collateral the trader's wallet must hold, by chain. */
  collateral: { chain: "solana"; mint: string; decimals: number; symbol: string };
  create(context: AdapterContext): ExecutionVenue;
}
