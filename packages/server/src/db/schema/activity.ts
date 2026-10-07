/** Watchlists, notifications, alerts, stats, and the platform tables (outbox,
    jobs, audit, reports, flags, idempotency). */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  bigserial,
} from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, ref, units, updatedAt, when } from "./columns";
import { users } from "./identity";
import { markets } from "./markets";
import { tradingAccounts } from "./trading";

// -------------------------------------------------------------- watchlists
export const watchlists = pgTable(
  "watchlists",
  {
    id: id(),
    ownerId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** The bookmark list: exactly one per user. */
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("watchlists_owner").on(t.ownerId),
    uniqueIndex("watchlists_one_default")
      .on(t.ownerId)
      .where(sql`is_default`),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    watchlistId: ref()
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    /** A fractional index: reordering rewrites one row, never the list. */
    rank: text().notNull(),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.watchlistId, t.marketId] })],
);

// ----------------------------------------------------------- notifications
export const NOTIFICATION_KINDS = [
  "Order",
  "Resolution",
  "Reply",
  "Follow",
  "Room",
  "Price",
] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
    icon: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    href: text().notNull(),
    cta: jsonb().$type<{ label: string; href: string; primary?: boolean }>(),
    /** One notification per real-world thing, however often its event replays. */
    dedupeKey: text(),
    createdAt: createdAt(),
    readAt: when(),
    emailedAt: when(),
  },
  (t) => [
    index("notifications_user_time").on(t.userId, t.createdAt),
    index("notifications_unread")
      .on(t.userId)
      .where(sql`read_at is null`),
    uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey),
    check("notifications_kind", oneOf("kind", NOTIFICATION_KINDS)),
  ],
);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    threshold: units().notNull(),
    direction: text({ enum: ["above", "below"] }).notNull(),
    active: boolean().notNull().default(true),
    triggeredAt: when(),
    createdAt: createdAt(),
  },
  (t) => [
    index("price_alerts_market")
      .on(t.marketId)
      .where(sql`active`),
    check("price_alerts_direction", oneOf("direction", ["above", "below"])),
  ],
);

// ------------------------------------------------------------------ stats
export const equityDaily = pgTable(
  "equity_daily",
  {
    accountId: ref()
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    day: date().notNull(),
    equity: units().notNull(),
    cash: units().notNull(),
    positionsValue: units().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
);

export const STAT_PERIODS = ["7D", "30D", "90D", "All"] as const;

export const traderStats = pgTable(
  "trader_stats",
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text({ enum: STAT_PERIODS }).notNull(),
    /** "All", or one of Hunch's categories. */
    category: text().notNull(),
    returnPct: doublePrecision().notNull(),
    correct: integer().notNull(),
    resolved: integer().notNull(),
    trades: integer().notNull(),
    pnl: units().notNull(),
    startingCapital: units().notNull(),
    /** Record fields that only exist for the whole history. */
    record: jsonb().$type<Record<string, unknown>>(),
    /** Cumulative P&L by day, for the profile chart. */
    curve: jsonb().$type<number[]>(),
    computedAt: when().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period, t.category] })],
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: id(),
    day: date().notNull(),
    period: text({ enum: STAT_PERIODS }).notNull(),
    category: text().notNull(),
    rows: jsonb().$type<Record<string, unknown>[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("leaderboard_snapshot_key").on(t.day, t.period, t.category),
  ],
);

// --------------------------------------------------------------- platform
/** Written in the same transaction as the change it describes; the worker
    relays it to realtime, notifications, email and analytics. */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    type: text().notNull(),
    subject: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    processedAt: when(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index("outbox_pending")
      .on(t.id)
      .where(sql`processed_at is null`),
  ],
);

export const JOB_STATUSES = ["pending", "running", "done", "dead"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    name: text().notNull(),
    payload: jsonb().$type<unknown>().notNull(),
    /** While a job with this key is pending or running, duplicates are dropped. */
    key: text(),
    status: text({ enum: JOB_STATUSES }).notNull().default("pending"),
    runAt: when().notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    lockedUntil: when(),
    lastError: text(),
    createdAt: createdAt(),
    finishedAt: when(),
  },
  (t) => [
    index("jobs_due")
      .on(t.runAt)
      .where(sql`status = 'pending'`),
    uniqueIndex("jobs_active_key")
      .on(t.key)
      .where(sql`key is not null and status in ('pending', 'running')`),
    check("jobs_status", oneOf("status", JOB_STATUSES)),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: ref(),
    action: text().notNull(),
    subject: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_subject").on(t.subject)],
);

export const reports = pgTable("reports", {
  id: id(),
  reporterId: ref()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subjectType: text({
    enum: ["post", "comment", "message", "user", "room"],
  }).notNull(),
  subjectId: ref().notNull(),
  reason: text().notNull(),
  status: text({ enum: ["open", "actioned", "dismissed"] })
    .notNull()
    .default("open"),
  resolverId: ref(),
  createdAt: createdAt(),
  resolvedAt: when(),
});

export const flags = pgTable("flags", {
  key: text().primaryKey(),
  enabled: boolean().notNull().default(false),
  /** Targeting: user ids, cohorts, venues. */
  rules: jsonb().$type<{
    users?: string[];
    cohorts?: string[];
    venues?: string[];
  }>(),
  updatedAt: updatedAt(),
});

/** Responses to non-order mutations sent with an Idempotency-Key, so a retry
    replays the first answer instead of acting twice. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: ref().notNull(),
    key: text().notNull(),
    route: text().notNull(),
    status: integer().notNull(),
    response: jsonb().$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
