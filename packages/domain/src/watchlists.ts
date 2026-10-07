import type { DemoState, Room } from "./types";

/** The list the bookmark saves to. Every account has it, and it can't be
    renamed or deleted. */
export const SAVED_LIST = "saved";

/** A list as the watchlist screens show it: yours, the saved default, or a
    room's shared list. */
export interface ListView {
  id: string;
  name: string;
  marketIds: string[];
  kind: "saved" | "own" | "room";
  updatedAt?: string;
  room?: Room;
}

export const roomListId = (roomId: string) => `room:${roomId}`;

/** Saved markets first, then the lists you made, in the order you made
    them. */
export function ownLists(state: DemoState): ListView[] {
  return [
    {
      id: SAVED_LIST,
      name: "Saved markets",
      marketIds: state.watchlist,
      kind: "saved",
    },
    ...state.watchlists.map((w) => ({
      id: w.id,
      name: w.name,
      marketIds: w.marketIds,
      updatedAt: w.updatedAt,
      kind: "own" as const,
    })),
  ];
}

/** The watchlists of rooms you belong to: shared with you. */
export function sharedLists(state: DemoState): ListView[] {
  return state.rooms
    .filter((r) => r.members.includes("you"))
    .map((r) => ({
      id: roomListId(r.id),
      name: r.name,
      marketIds: r.watchlist,
      kind: "room" as const,
      room: r,
    }));
}

export const marketCount = (n: number) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "market" : "markets"}`;

const DAY = 86_400_000;

/** "Updated today", "Updated yesterday", "Updated Sep 22" — UTC, like the
    rest of the demo. */
export function updatedLabel(iso: string, now: number) {
  const days = Math.floor(now / DAY) - Math.floor(Date.parse(iso) / DAY);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

/** Move an item within a list, or put it in at that place. */
export function placeIn(ids: string[], id: string, index: number) {
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
