import type { Channel, DemoState, Post, Room, RoomRole } from "./types";

/** The channel that lists a room's predictions rather than chat. */
export const PREDICTIONS_CHANNEL = "predictions";

export const readKey = (roomId: string, channel: string) =>
  `${roomId}/${channel}`;

export const roleOf = (room: Room, traderId: string): RoomRole =>
  room.owner === traderId
    ? "Owner"
    : room.moderators.includes(traderId)
      ? "Moderator"
      : "Member";

/** Owners and moderators run the room; everyone else takes part. */
export const canModerate = (room: Room) =>
  room.owner === "you" || room.moderators.includes("you");

export const chatChannels = (room: Room) =>
  room.channels.filter((c) => c.id !== PREDICTIONS_CHANNEL);

/** Predictions about the room: posted to it, or public on its markets. */
export const roomPredictions = (room: Room, posts: Post[]) =>
  posts
    .filter(
      (p) =>
        p.audience === room.id ||
        (p.audience === "public" && room.watchlist.includes(p.marketId)),
    )
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));

/** New since you last looked, never counting what you wrote yourself. */
export function unreadIn(state: DemoState, room: Room, channel: Channel) {
  if (!room.members.includes("you")) return 0;
  const read = Date.parse(
    state.channelReads[readKey(room.id, channel.id)] ?? "",
  );
  const after = (at: string) => Number.isNaN(read) || Date.parse(at) > read;
  if (channel.id === PREDICTIONS_CHANNEL)
    return roomPredictions(room, state.posts).filter(
      (p) => p.authorId !== "you" && after(p.at),
    ).length;
  // System lines and thread replies don't make a channel unread.
  return room.messages.filter(
    (m) =>
      m.channel === channel.id &&
      !m.kind &&
      !m.parentId &&
      m.authorId !== "you" &&
      after(m.at),
  ).length;
}

/** Where you left off: the channel you read last, else the first chat. */
export function lastChannel(state: DemoState, room: Room) {
  let best: Channel | undefined;
  let latest = -Infinity;
  for (const c of room.channels) {
    const read = Date.parse(state.channelReads[readKey(room.id, c.id)] ?? "");
    if (read > latest) {
      latest = read;
      best = c;
    }
  }
  return best ?? chatChannels(room)[0] ?? room.channels[0];
}

const DAY = 86_400_000;
const utcDay = (ms: number) => Math.floor(ms / DAY);

/** "14:02" — chat times, in UTC like the rest of the demo. */
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });

/** A day separator: Today, Yesterday, or "Thursday, Sep 25". */
export function dayLabel(iso: string, now: number) {
  const days = utcDay(now) - utcDay(Date.parse(iso));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "today at 14:13", "yesterday at 09:02", "Sep 25 at 14:13". */
export function dayAndTime(iso: string, now: number) {
  const days = utcDay(now) - utcDay(Date.parse(iso));
  const day =
    days === 0
      ? "today"
      : days === 1
        ? "yesterday"
        : new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
  return `${day} at ${clockTime(iso)}`;
}

/** Consecutive messages from one author, a few minutes apart, share a
    group — as chat apps stack them. */
export const GROUP_GAP = 5 * 60_000;
export const sameGroup = (
  a: { authorId: string; at: string },
  b: { authorId: string; at: string },
) =>
  a.authorId === b.authorId &&
  utcDay(Date.parse(a.at)) === utcDay(Date.parse(b.at)) &&
  Date.parse(b.at) - Date.parse(a.at) <= GROUP_GAP;
