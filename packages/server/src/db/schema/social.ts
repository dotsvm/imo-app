/** Follows, predictions, comments and reactions. */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, ref, units, when } from "./columns";
import { users } from "./identity";
import { markets } from "./markets";

export const follows = pgTable(
  "follows",
  {
    followerId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The bell: tell me when they post a prediction. */
    notify: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee").on(t.followeeId),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: id(),
    authorId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marketId: ref()
      .notNull()
      .references(() => markets.id),
    outcome: text().notNull(),
    /** Stamped by the server from the live quote when the post is published. */
    entryPrice: units().notNull(),
    text: text().notNull(),
    invalidation: text(),
    confidence: text({ enum: ["Low", "Medium", "High"] }).notNull(),
    disclosePosition: boolean().notNull().default(false),
    /** A system-attested snapshot of the author's position when posting. */
    positionSnapshot: jsonb().$type<{
      quantity: number;
      averagePrice: number;
      outcome: string;
    }>(),
    /** Null for public; otherwise the room it was posted to. */
    roomId: ref(),
    /** Editable until then; immutable after (track records stay honest). */
    editableUntil: when().notNull(),
    likes: integer().notNull().default(0),
    reposts: integer().notNull().default(0),
    views: integer().notNull().default(0),
    comments: integer().notNull().default(0),
    backed: integer().notNull().default(0),
    faded: integer().notNull().default(0),
    evidenceShares: integer().notNull().default(0),
    clientId: text(),
    createdAt: createdAt(),
    editedAt: when(),
    deletedAt: when(),
  },
  (t) => [
    index("posts_author_time").on(t.authorId, t.createdAt),
    index("posts_market_time").on(t.marketId, t.createdAt),
    index("posts_time").on(t.createdAt),
    index("posts_room_time").on(t.roomId, t.createdAt),
    uniqueIndex("posts_client").on(t.authorId, t.clientId),
    check("posts_text_length", sql`char_length(${t.text}) between 1 and 600`),
    check("posts_confidence", oneOf("confidence", ["Low", "Medium", "High"])),
  ],
);

export const postImages = pgTable(
  "post_images",
  {
    id: id(),
    postId: ref()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    storageKey: text().notNull(),
    alt: text().notNull(),
    caption: text().notNull().default(""),
    width: integer().notNull(),
    height: integer().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [check("post_images_alt", sql`char_length(${t.alt}) > 0`)],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    postId: ref()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** A reply to another comment; one level of nesting. */
    parentId: ref(),
    text: text().notNull(),
    likes: integer().notNull().default(0),
    clientId: text(),
    createdAt: createdAt(),
    deletedAt: when(),
  },
  (t) => [
    index("comments_post_time").on(t.postId, t.createdAt),
    uniqueIndex("comments_client").on(t.authorId, t.clientId),
    check("comments_length", sql`char_length(${t.text}) between 1 and 2000`),
  ],
);

export const REACTION_KINDS = ["like", "bookmark", "repost"] as const;

export const reactions = pgTable(
  "reactions",
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectType: text({ enum: ["post", "comment"] }).notNull(),
    subjectId: ref().notNull(),
    kind: text({ enum: REACTION_KINDS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subjectType, t.subjectId, t.kind] }),
    index("reactions_subject").on(t.subjectType, t.subjectId, t.kind),
  ],
);
