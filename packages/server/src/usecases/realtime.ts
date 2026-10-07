/**
 * Which realtime channels a person may listen to through the API's stream.
 * The same rules as the Supabase policy (packages/server/drizzle/0006_realtime.sql): markets
 * and posts are open; your own user channel; rooms you belong to.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Channel } from "@imo/core/ports/platform";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { forbidden, invalid } from "../errors";
import type { Viewer } from "./viewer";

export const MAX_CHANNELS = 20;
const SAFE = /^[A-Za-z0-9_-]{1,120}$/;

/** `user:me` stands for the viewer's own channel. */
export async function authorizeChannels(
  db: Db,
  viewer: Viewer | null,
  requested: string[],
): Promise<Channel[]> {
  const unique = [...new Set(requested.map((c) => c.trim()).filter(Boolean))];
  if (!unique.length) throw invalid("Name at least one channel.");
  if (unique.length > MAX_CHANNELS)
    throw invalid(`Listen to at most ${MAX_CHANNELS} channels at once.`);
  const allowed: Channel[] = [];
  const rooms: string[] = [];
  for (const name of unique) {
    const [kind, id] = name.split(":", 2);
    if (!id || !SAFE.test(id)) throw invalid(`Unknown channel ${name}.`);
    if (kind === "market" || kind === "post") allowed.push(`${kind}:${id}`);
    else if (kind === "user") {
      if (!viewer || (id !== "me" && id !== viewer.userId))
        throw forbidden("You can only listen to your own updates.");
      allowed.push(`user:${viewer.userId}`);
    } else if (kind === "room") rooms.push(id);
    else throw invalid(`Unknown channel ${name}.`);
  }
  if (rooms.length) {
    if (!viewer) throw forbidden("Sign in to follow a room.");
    const member = await db
      .select({ roomId: t.roomMembers.roomId })
      .from(t.roomMembers)
      .where(
        and(
          eq(t.roomMembers.userId, viewer.userId),
          inArray(t.roomMembers.roomId, rooms.filter((r) => /^[0-9a-f-]{36}$/.test(r))),
        ),
      );
    const ok = new Set(member.map((m) => m.roomId));
    for (const room of rooms) {
      if (!ok.has(room)) throw forbidden("You're not a member of that room.");
      allowed.push(`room:${room}`);
    }
  }
  return allowed;
}
