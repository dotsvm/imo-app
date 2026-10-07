/** Product catalogs the server owns: notification preferences, the paper
    route, starter content. Data, not code paths. */
import type { FeeModel } from "@imo/core/fees";

export interface PreferenceDefinition {
  id: string;
  label: string;
  description: string;
  app: boolean;
  email: boolean;
  /** Safety notifications can't be switched off in the app. */
  locked?: boolean;
}

export const NOTIFICATION_PREFERENCES: readonly PreferenceDefinition[] = [
  {
    id: "order-filled",
    label: "Order filled / partial",
    description: "Every fill, including partial fills",
    app: true,
    email: true,
  },
  {
    id: "order-failed",
    label: "Order failed",
    description: "Always on for safety",
    app: true,
    email: true,
    locked: true,
  },
  {
    id: "resolved",
    label: "Market resolved",
    description: "Includes claimable payouts",
    app: true,
    email: true,
  },
  {
    id: "closing",
    label: "Market closing soon",
    description: "24h before close, markets you hold",
    app: true,
    email: true,
  },
  {
    id: "replies",
    label: "Replies & mentions",
    description: "On your predictions and in rooms",
    app: true,
    email: false,
  },
  {
    id: "followers",
    label: "New followers",
    description: "Someone starts following you",
    app: true,
    email: false,
  },
  {
    id: "digest",
    label: "Traders you follow post",
    description: "Daily digest by email",
    app: true,
    email: false,
  },
  {
    id: "rooms",
    label: "Room activity",
    description: "Only rooms set to “all”",
    app: true,
    email: false,
  },
];

/** Hunch's 0.5% of notional: the paper route's fee, its own ticket line. */
export const APP_FEE_MODEL: FeeModel = {
  kind: "bps",
  bps: 50,
  appliesTo: "both",
  rounding: { mode: "half-up", decimals: 2 },
};

/** A room's badge colours: soft tints that keep its initials legible. */
export const ROOM_COLORS = {
  lavender: "#b9bbd6",
  sage: "#a9c4b1",
  sand: "#d8c9a3",
  rose: "#d8b0b0",
  sky: "#a9c4d5",
} as const;
export type RoomColor = keyof typeof ROOM_COLORS;

export const PAPER_ROUTE = "paper";
/** Real money: the trader's own wallet signs each venue transaction. imo
    takes no fee on top of the venue's. */
export const WALLET_ROUTE = "wallet";
export const NO_APP_FEE: FeeModel = { kind: "none" };

/** The beta's floor for ranking: fewer resolved calls is too little to judge. */
export const MIN_SAMPLE = 10;

/** A handle: 2–24 letters, numbers or underscores (the database checks too). */
export const HANDLE_PATTERN = /^[A-Za-z0-9_]{2,24}$/;

/** Handles no one can claim: the product's own names, staff-sounding ones,
    and the app's own routes. */
const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "support", "help", "helpdesk",
  "imo", "hunch", "official", "team", "staff", "mod", "mods", "moderator",
  "security", "abuse", "legal", "privacy", "terms", "billing", "api", "www",
  "mail", "email", "noreply", "no_reply", "you", "me", "settings", "discover",
  "market", "markets", "room", "rooms", "trader", "traders", "post", "posts",
  "portfolio", "position", "positions", "leaderboard", "notifications",
  "watchlist", "watchlists", "waitlist", "welcome", "login", "logout",
  "signin", "signup", "register", "invite", "invites", "null", "undefined",
]);
export const isReservedHandle = (handle: string) => RESERVED_HANDLES.has(handle.toLowerCase());

/** Avatar colors for new people, from the design system's palette. */
export const AVATAR_COLORS = [
  "#2b3b28",
  "#3b2c28",
  "#28323b",
  "#352b3b",
  "#3b3528",
  "#283b37",
];
