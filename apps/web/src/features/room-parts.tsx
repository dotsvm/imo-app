"use client";
/* Pieces the rooms screens share: the room's mark, the join control, and
   a market picker for linking and seeding markets. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Market, Room } from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import { Check, MagnifyingGlass, Plus } from "@/components/icons";
import styles from "./room-parts.module.css";
import { venueName } from "@/data/venues";

/** The room's two-letter mark on a rounded square. */
export function RoomMark({
  room,
  size = 44,
}: {
  room: Pick<Room, "symbol">;
  size?: 32 | 44;
}) {
  return (
    <span className={styles.mark} data-size={size} aria-hidden="true">
      {room.symbol}
    </span>
  );
}

/** Join · Joined · Request · Requested, or Owner for your own room. */
export function JoinButton({
  room,
  chip = false,
}: {
  room: Room;
  /** 08.2: the compact chip on a phone row. */
  chip?: boolean;
}) {
  const { services } = useDemo();
  const member = room.members.includes("you");
  const requested = room.requests.includes("you");
  if (room.owner === "you")
    return (
      <span className={chip ? styles.chip : "tag tag-neutral"} data-owner>
        Owner
      </span>
    );
  const label = member
    ? "Joined"
    : requested
      ? "Requested"
      : room.privacy === "Invite only"
        ? "Request"
        : "Join";
  return (
    <button
      type="button"
      className={
        chip
          ? styles.chip
          : `btn ${member || requested ? "btn-secondary" : "btn-primary"}`
      }
      data-active={!member && !requested ? true : undefined}
      aria-pressed={member}
      aria-label={`${label} · ${room.name}`}
      disabled={requested}
      title={
        member
          ? "Leave this room"
          : requested
            ? "Waiting for approval"
            : undefined
      }
      onClick={() => {
        if (member || room.privacy === "Public")
          services.social.joinRoom(room.id);
        else services.social.requestJoin(room.id);
      }}
    >
      {label}
    </button>
  );
}

/**
 * A searchable list of markets in a popover: link one to a message, or
 * add it to a room. Escape and outside clicks close it.
 */
export function MarketPicker({
  label,
  trigger,
  triggerClassName = "",
  selected = [],
  onPick,
  keepOpen = false,
  align = "start",
  placement = "below",
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  /** Markets shown with a check. */
  selected?: string[];
  onPick: (market: Market) => void;
  /** Stay open after a pick, for adding several. */
  keepOpen?: boolean;
  align?: "start" | "end";
  placement?: "below" | "above";
}) {
  const { services } = useDemo();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const markets = services.markets
    .list()
    .filter((m) => m.status === "open")
    .filter((m) =>
      words.every((w) =>
        `${m.title} ${m.shortTitle} ${m.category} ${venueName(m.venueId)}`
          .toLowerCase()
          .includes(w),
      ),
    )
    .slice(0, 30);
  return (
    <div className={styles.pickerRoot} ref={root}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className={styles.picker}
          role="dialog"
          aria-label={label}
          data-align={align}
          data-placement={placement}
        >
          <label className={styles.pickerSearch}>
            <MagnifyingGlass size={14} />
            <span className="sr-only">Search markets</span>
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Search markets"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.pickerList}>
            {markets.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onPick(m);
                    if (!keepOpen) {
                      setOpen(false);
                      setQuery("");
                    }
                  }}
                >
                  <span>
                    <b>{m.shortTitle}</b>
                    <span>
                      {venueName(m.venueId)} · {m.category}
                    </span>
                  </span>
                  <span className={styles.pickerPrice}>{m.yesPrice}¢</span>
                  {on ? (
                    <Check size={14} className={styles.pickerOn} />
                  ) : (
                    <Plus size={14} className={styles.pickerOff} />
                  )}
                </button>
              );
            })}
            {!markets.length && (
              <p className={styles.pickerEmpty}>No open markets match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
