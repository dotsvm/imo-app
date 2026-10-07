/** People, how they sign in, their wallets and their settings. Users are
    ours: providers map onto them through auth_identities, so changing auth
    providers is an import, not a migration. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, ref, updatedAt, when } from "./columns";

export const CATEGORIES = [
  "Economics",
  "Politics",
  "Tech",
  "Science",
  "Climate",
  "Sports",
  "Crypto",
  "Culture",
] as const;

export const users = pgTable(
  "users",
  {
    id: id(),
    handle: text().notNull(),
    displayName: text().notNull(),
    bio: text().notNull().default(""),
    focus: text().notNull().default(""),
    avatarUrl: text(),
    /** Avatar fallback: two letters on a color. */
    initials: text().notNull(),
    color: text().notNull().default("#252832"),
    region: text().notNull().default(""),
    role: text({ enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    status: text({ enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    /** Seeded demo people are marked, so they never mix with real users. */
    isDemo: boolean().notNull().default(false),
    /** Private beta: when this person was let in. Null means waiting. */
    accessGrantedAt: when(),
    /** Counters kept with every follow and unfollow, in the same transaction. */
    followersCount: integer().notNull().default(0),
    followingCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: when(),
  },
  (t) => [
    uniqueIndex("users_handle").on(sql`lower(${t.handle})`),
    check("users_role", oneOf("role", ["user", "admin"])),
    check("users_status", oneOf("status", ["active", "suspended"])),
    check("users_handle_shape", sql`${t.handle} ~ '^[A-Za-z0-9_]{2,24}$'`),
  ],
);

/** One row per way of signing in: a Supabase account (Google, wallet), or the
    dev identity used locally and in tests. */
export const authIdentities = pgTable(
  "auth_identities",
  {
    provider: text().notNull(),
    subject: text().notNull(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    index("auth_identities_user").on(t.userId),
  ],
);

export const WALLET_CHAINS = ["solana", "ethereum"] as const;

export const wallets = pgTable(
  "wallets",
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: text({ enum: WALLET_CHAINS }).notNull(),
    address: text().notNull(),
    /** Embedded wallets are created for the user by the wallet provider;
        external ones are brought by the user and proven by signature. */
    custody: text({ enum: ["embedded", "external"] }).notNull(),
    provider: text().notNull(),
    isPrimary: boolean().notNull().default(false),
    verifiedAt: when(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("wallets_address").on(t.chain, t.address),
    index("wallets_user").on(t.userId),
    check("wallets_chain", oneOf("chain", WALLET_CHAINS)),
    check("wallets_custody", oneOf("custody", ["embedded", "external"])),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: ref()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  interests: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  onboarded: boolean().notNull().default(false),
  email: text(),
  /** Mail goes only to a verified address: the sign-in provider vouched
      for it, or its owner followed the link we sent. */
  emailVerifiedAt: when(),
  /** When the daily digest last went out, so it goes once a day. */
  lastDigestAt: when(),
  theme: text({ enum: ["Midnight", "Dim", "System"] })
    .notNull()
    .default("Midnight"),
  priceInCents: boolean().notNull().default(true),
  showPositionsOnPosts: boolean().notNull().default(true),
  appearOnLeaderboard: boolean().notNull().default(true),
  privateOpenPositions: boolean().notNull().default(false),
  updatedAt: updatedAt(),
});

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    app: boolean().notNull().default(true),
    email: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

export const invites = pgTable("invites", {
  code: text().primaryKey(),
  createdBy: ref().references(() => users.id),
  maxUses: integer().notNull().default(1),
  uses: integer().notNull().default(0),
  /** Who it's for, when it was sent from the waitlist. */
  email: text(),
  note: text(),
  expiresAt: when(),
  revokedAt: when(),
  createdAt: createdAt(),
});

/** Who used which code, for the audit trail and "invited by". */
export const inviteRedemptions = pgTable(
  "invite_redemptions",
  {
    code: text()
      .notNull()
      .references(() => invites.code, { onDelete: "cascade" }),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.code, t.userId] })],
);

export const waitlist = pgTable(
  "waitlist",
  {
    email: text().primaryKey(),
    note: text(),
    /** The account that claimed its handle from the waitlist page, once
        someone signs in to hold their place. */
    userId: ref().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    invitedAt: when(),
    /** The founding pass's colour, as picked on the waitlist page. */
    edition: text().notNull().default("classic"),
    /** Places moved up the line: for sharing the pass, and for each friend
        who claims through your link. Your pass number never changes. */
    boost: integer().notNull().default(0),
    /** When the pass was first shared: sharing moves you up once. */
    sharedAt: when(),
    /** The account whose link you claimed through. */
    referredBy: ref().references(() => users.id, { onDelete: "set null" }),
    /** How many people opened your link, for the claimed card. */
    linkOpens: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("waitlist_user").on(t.userId).where(sql`${t.userId} is not null`),
    check("waitlist_edition", oneOf("edition", ["classic", "macro", "crypto", "politics"])),
  ],
);
