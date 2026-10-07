"use client";
/* 10.3 · save to watchlist: every list you can save to, ticked where the
   market already is, and a new list in one step. */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Market } from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import { ownLists, sharedLists, type ListView } from "@imo/domain/watchlists";
import { BookmarkSimple } from "@/components/icons";
import styles from "./save-to-list.module.css";

export function SaveToList({
  market,
  iconOnly = false,
  triggerClassName = "",
  savedClassName = "",
}: {
  market: Market;
  /** Phones: the bookmark alone. */
  iconOnly?: boolean;
  triggerClassName?: string;
  /** For the bookmark once the market is on a list. */
  savedClassName?: string;
}) {
  const { state, services } = useDemo();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const lists = [...ownLists(state), ...sharedLists(state)];
  const holding = lists.filter((l) => l.marketIds.includes(market.id));
  // Name the list you made over the default, and either over a room's.
  const home =
    holding.find((l) => l.kind === "own") ??
    holding.find((l) => l.kind === "saved") ??
    holding[0];
  const more = holding.length - 1;
  const text = home
    ? `In “${home.name}”${more > 0 ? ` +${more}` : ""}`
    : "Add to watchlist";
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const toggle = (l: ListView) =>
    l.kind === "room"
      ? services.social.toggleRoomMarket(l.room!.id, market.id)
      : services.watchlists.toggleMarket(l.id, market.id);
  const add = (event: FormEvent) => {
    event.preventDefault();
    try {
      services.watchlists.create(name, market.id);
      setName("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={
          iconOnly
            ? home
              ? `${text} — choose watchlists`
              : "Add to watchlist"
            : undefined
        }
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <BookmarkSimple
          size={iconOnly ? 18 : 15}
          className={home ? savedClassName : undefined}
        />
        {!iconOnly && text}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={styles.panel}
          role="dialog"
          aria-label={`Save ${market.shortTitle} to a watchlist`}
        >
          <p className={styles.label} aria-hidden="true">
            Save “{market.shortTitle}” to
          </p>
          <ul className={styles.lists}>
            {lists.map((l) => {
              const on = l.marketIds.includes(market.id);
              return (
                <li key={l.id}>
                  <label className={styles.option} data-on={on || undefined}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(l)}
                    />
                    <span className={styles.name}>
                      {l.name}
                      {l.kind === "room" && (
                        <span className={styles.kind}> · room</span>
                      )}
                    </span>
                    <span className={styles.count}>
                      {l.marketIds.length}
                      <span className="sr-only"> markets</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <form className={styles.add} onSubmit={add}>
            <label className="sr-only" htmlFor={`${id}-name`}>
              New list name
            </label>
            <input
              id={`${id}-name`}
              className="input"
              placeholder="New list name"
              value={name}
              maxLength={60}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim()}
            >
              Add
            </button>
          </form>
          {error && (
            <p className={`field-error ${styles.error}`} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
