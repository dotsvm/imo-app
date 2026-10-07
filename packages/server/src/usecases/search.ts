/** One box, four kinds of answer: markets, traders, rooms, predictions. */
import { and, desc, ilike, isNull, or, sql } from "drizzle-orm";
import type { Deps } from "../composition";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { listMarkets } from "./markets";
import { listTraders } from "./people";
import { hydratePosts } from "./posts";
import { listRooms } from "./rooms";
import type { Viewer } from "./viewer";

export async function search(deps: Pick<Deps, "clock" | "storage">, db: Db, viewer: Viewer | null, q: string) {
  const text = q.trim();
  if (text.length < 2) return { markets: [], traders: [], rooms: [], posts: [] };
  const like = `%${text.replace(/[%_\\]/g, "")}%`;
  const [markets, traders, rooms, posts] = await Promise.all([
    listMarkets(db, { q: text, status: "all", limit: 8 }, deps.clock.now()),
    listTraders(db, viewer, { q: text, limit: 5 }),
    listRooms(deps, db, viewer, { q: text, limit: 5 }),
    db
      .select()
      .from(t.posts)
      .where(and(isNull(t.posts.deletedAt), isNull(t.posts.roomId), or(ilike(t.posts.text, like), ilike(sql`coalesce(${t.posts.invalidation}, '')`, like))))
      .orderBy(desc(t.posts.createdAt))
      .limit(5),
  ]);
  return {
    markets: markets.items,
    traders: traders.items,
    rooms: rooms.items,
    posts: await hydratePosts(deps, db, viewer, posts),
  };
}
