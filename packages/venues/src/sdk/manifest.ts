/**
 * A venue's manifest: identity, capabilities, fees, lifecycle vocabulary,
 * presentation and data rights. Plain data with no I/O, so the browser can
 * import it for badges and labels while the server uses it to drive behavior.
 *
 * The core branches on `capabilities`, never on `id`.
 */
import { feeFor, type FeeModel } from "@imo/core/fees";
import { MARKET_STATUSES, type MarketStatus } from "@imo/core/lifecycle";
import type { MarketType, VenueId } from "@imo/core/market";
import { currency } from "@imo/core/money";

export interface VenueCapabilities {
  marketTypes: MarketType[];
  orderTypes: ("market" | "limit")[];
  timeInForce: ("ioc" | "fok" | "gtc" | "gtd")[];
  fractionalQuantity: boolean;
  /** Fixed for the venue, set per market, or able to change mid-life. */
  tick: "fixed" | "per-market" | "dynamic";
  streaming: {
    quotes: boolean;
    book: "none" | "snapshot" | "delta";
    trades: boolean;
    lifecycle: boolean;
  };
  history: { candleIntervals: ("1m" | "1h" | "1d")[] };
  settlement: { kind: "exchange" | "oracle"; disputes: boolean };
  pauses: ("trading" | "exchange")[];
}

export interface VenueDisplay {
  name: string;
  /** One or two characters, for places without room for a logo. */
  mark: string;
  /** A public path, square, shown round at 16px. */
  logo?: string;
  /** Brand color behind a letter mark. */
  color: string;
  /** The small inline chip beside a venue's name. */
  chip: { background: string; foreground: string };
  /** Names the venue's fee on a ticket. */
  feeLabel: string;
  /** How results become final. */
  settlementCopy: string;
}

export interface VenueDataRights {
  /** Whether we may show this venue's market data to users at all. */
  display: boolean;
  /** How long a quote may be cached before it must be refreshed. */
  quoteTtlSeconds: number;
  storeCandles: boolean;
  storeTrades: boolean;
  attribution?: string;
}

export interface VenueManifest {
  id: VenueId;
  kind: "exchange" | "protocol";
  /** Registered currency code the venue settles in. */
  collateral: string;
  display: VenueDisplay;
  capabilities: VenueCapabilities;
  fees: {
    /** Used when a market doesn't publish its own fee parameters. */
    default: FeeModel;
    /** Defaults by the venue's own category names. */
    byCategory?: Record<string, FeeModel>;
  };
  /** The venue's lifecycle vocabulary → canonical status. Anything unmapped
      becomes "unknown", which blocks trading and alerts. */
  statusMap: Record<string, MarketStatus>;
  /** Recurring pauses in the venue's time zone. */
  schedule?: {
    timeZone: string;
    maintenance: {
      rrule: string;
      minutes: number;
      kind: "trading" | "exchange";
    }[];
  };
  dataRights: VenueDataRights;
  regions?: { allow?: string[]; deny?: string[] };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Validate a manifest once, at definition time, so a typo fails the build
    rather than a user's order. */
export function defineVenue(manifest: VenueManifest): Readonly<VenueManifest> {
  const problems: string[] = [];
  const { id, display, capabilities, fees, statusMap } = manifest;
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id))
    problems.push(`id "${id}" must be lower-case letters, digits and dashes`);
  try {
    currency(manifest.collateral);
  } catch {
    problems.push(
      `collateral ${manifest.collateral} is not a registered currency`,
    );
  }
  if (!display.name.trim()) problems.push("display.name is empty");
  if (display.mark.length < 1 || display.mark.length > 2)
    problems.push("display.mark must be one or two characters");
  for (const [key, value] of [
    ["color", display.color],
    ["chip.background", display.chip.background],
    ["chip.foreground", display.chip.foreground],
  ] as const)
    if (!HEX.test(value)) problems.push(`display.${key} must be a hex color`);
  if (capabilities.marketTypes.length === 0)
    problems.push("capabilities.marketTypes is empty");
  if (capabilities.orderTypes.length === 0)
    problems.push("capabilities.orderTypes is empty");
  for (const [state, status] of Object.entries(statusMap))
    if (!MARKET_STATUSES.includes(status))
      problems.push(
        `statusMap.${state} → "${status}" is not a canonical status`,
      );
  const probe = {
    price: 500_000,
    quantity: 100,
    quantityScale: 0,
    currencyScale: 6,
    liquidity: "taker" as const,
  };
  for (const [name, model] of [
    ["default", fees.default],
    ...Object.entries(fees.byCategory ?? {}),
  ] as const)
    try {
      if (feeFor(model, probe) < 0) problems.push(`fees.${name} is negative`);
    } catch (error) {
      problems.push(`fees.${name}: ${(error as Error).message}`);
    }
  if (manifest.dataRights.quoteTtlSeconds <= 0)
    problems.push("dataRights.quoteTtlSeconds must be positive");
  if (problems.length)
    throw new Error(
      `Venue manifest "${id}" is invalid:\n- ${problems.join("\n- ")}`,
    );
  return Object.freeze(manifest);
}

/** The venue's default fee for a market in one of its categories. */
export function defaultFee(
  manifest: Pick<VenueManifest, "fees">,
  venueCategory?: string,
): FeeModel {
  return (
    (venueCategory && manifest.fees.byCategory?.[venueCategory]) ||
    manifest.fees.default
  );
}

/** Map a venue state; unmapped states are quarantined as "unknown". */
export function mapStatus(
  manifest: Pick<VenueManifest, "statusMap">,
  venueState: string,
): MarketStatus {
  return manifest.statusMap[venueState] ?? "unknown";
}
