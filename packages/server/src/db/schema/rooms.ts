/** Rooms: members and roles, channels, messages with threads, read markers,
    and the room's shared market list. */
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
import { createdAt, id, oneOf, ref, when } from "./columns";
import { users } from "./identity";
import { markets } from "./markets";

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    symbol: text().notNull().default(""),
    /** The badge colour behind the symbol, from ROOM_COLORS. */
    color: text().notNull().default(""),
    /** An uploaded picture shown instead of the symbol. */
    avatarUrl: text(),
    /** What the room is about, as short tags people can find it by. */
    topics: text().array().notNull().default(sql`'{}'::text[]`),
    ownerId: ref()
      .notNull()
      .references(() => users.id),
    privacy: text({ enum: ["public", "invite"] }).notNull(),
    /** Members' holdings show on messages about linked markets. */
    disclosure: boolean().notNull().default(false),
    rules: text().notNull().default(""),
    memberCount: integer().notNull().default(0),
    archivedAt: when(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("rooms_slug").on(t.slug),
    check("rooms_privacy", oneOf("privacy", ["public", "invite"])),
  ],
);

export const ROOM_ROLES = ["owner", "moderator", "member"] as const;

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: ref()
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text({ enum: ROOM_ROLES }).notNull().default("member"),
    notify: text({ enum: ["all", "mentions", "nothing"] })
      .notNull()
      .default("mentions"),
    joinedAt: createdAt(),
    /** Last read or post here: "online" counts members seen in 5 minutes. */
    lastSeenAt: when(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("room_members_user").on(t.userId),
    check("room_members_role", oneOf("role", ROOM_ROLES)),
  ],
);

export const roomRequests = pgTable(
  "room_requests",
  {
    roomId: ref()
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);

export const channels = pgTable(
  "channels",
  {
    id: id(),
    roomId: ref()
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    topic: text().notNull(),
    /** The market a channel is about: members' holdings in it show there. */
    marketId: ref().references(() => markets.id),
    position: integer().notNull().default(0),
  },
  (t) => [uniqueIndex("channels_room_slug").on(t.roomId, t.slug)],
);

export const roomMessages = pgTable(
  "room_messages",
  {
    id: id(),
    roomId: ref()
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    channelId: ref()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** A reply in the thread under another message. */
    parentId: ref(),
    text: text().notNull().default(""),
    marketId: ref().references(() => markets.id),
    kind: text({ enum: ["message", "join"] })
      .notNull()
      .default("message"),
    withIds: text().array(),
    /** Set by the sender, so a retried send lands once. */
    clientId: text(),
    createdAt: createdAt(),
    editedAt: when(),
    deletedAt: when(),
  },
  (t) => [
    index("room_messages_channel_time").on(t.channelId, t.createdAt),
    index("room_messages_thread").on(t.parentId),
    uniqueIndex("room_messages_client").on(t.authorId, t.clientId),
    check("room_messages_length", sql`char_length(${t.text}) <= 4000`),
  ],
);

export const channelReads = pgTable(
  "channel_reads",
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: ref()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    lastReadAt: when().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

export const roomMarkets = pgTable(
  "room_markets",
  {
    roomId: ref()
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    addedBy: ref().references(() => users.id),
    rank: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.marketId] })],
);
