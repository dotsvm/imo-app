"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";
import { venueName } from "@/data/venues";
import type { Market } from "@imo/domain/types";
import { ArrowRight, FunnelSimple } from "@/components/icons";
import {
  narrow,
  STATUSES,
  VENUES,
  type Filters,
  type Sort,
  type Status,
  type VenueFilter,
} from "./discover-model";
import styles from "./discover-filters.module.css";

export type FilterPatch = Partial<{
  sort: Sort;
  venue: VenueFilter;
  status: Status;
  min: number | null;
  max: number | null;
}>;
type Draft = {
  sort: Sort;
  venue: VenueFilter;
  status: Status;
  min: string;
  max: string;
};
const DEFAULTS: Draft = {
  sort: "Trending",
  venue: "All",
  status: "open",
  min: "",
  max: "",
};
/** Whole cents between 0 and 100, or nothing. */
const toCents = (value: string) => {
  const n = Number(value.replace(/[¢\s]/g, ""));
  return value.trim() && Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
};
const draftOf = (f: Filters): Draft => ({
  sort: f.sort,
  venue: f.venue,
  status: f.status,
  min: f.min === null ? "" : String(f.min),
  max: f.max === null ? "" : String(f.max),
});

function StatusField({
  value,
  onChange,
  name,
}: {
  value: Status;
  onChange: (value: Status) => void;
  name: string;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.label}>Status</legend>
      <div className={styles.radios}>
        {STATUSES.map(([v, text]) => (
          <label key={v} className={`radio ${styles.radio}`}>
            <input
              type="radio"
              name={name}
              checked={value === v}
              onChange={() => onChange(v)}
            />
            <span className="dot" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PriceField({
  min,
  max,
  onMin,
  onMax,
}: {
  min: string;
  max: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
}) {
  const id = useId();
  return (
    <fieldset className={styles.group}>
      <legend className={styles.label}>Yes price</legend>
      <div className={styles.price}>
        <label className={styles.cents} htmlFor={`${id}-min`}>
          <span className="sr-only">Lowest Yes price in cents</span>
          <input
            id={`${id}-min`}
            className="input"
            inputMode="numeric"
            placeholder="0"
            value={min}
            onChange={(e) => onMin(e.target.value)}
          />
          <span aria-hidden="true">¢</span>
        </label>
        <span className={styles.to} aria-hidden="true">
          to
        </span>
        <label className={styles.cents} htmlFor={`${id}-max`}>
          <span className="sr-only">Highest Yes price in cents</span>
          <input
            id={`${id}-max`}
            className="input"
            inputMode="numeric"
            placeholder="100"
            value={max}
            onChange={(e) => onMax(e.target.value)}
          />
          <span aria-hidden="true">¢</span>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * 02.1 "Filters · N": status and price in a popover under the toolbar;
 * sort and venue keep their own controls beside it. Changes apply at once.
 */
export function FiltersPopover({
  filters,
  count,
  onChange,
}: {
  filters: Filters;
  count: number;
  onChange: (patch: FilterPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [min, setMin] = useState(
    filters.min === null ? "" : String(filters.min),
  );
  const [max, setMax] = useState(
    filters.max === null ? "" : String(filters.max),
  );
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={styles.popoverRoot} ref={root}>
      <button
        ref={button}
        className="btn btn-secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <FunnelSimple size={14} />
        Filters · {count}
      </button>
      {open && (
        <div
          id={panelId}
          className={styles.popover}
          role="group"
          aria-label="Market filters"
        >
          <StatusField
            name={`${panelId}-status`}
            value={filters.status}
            onChange={(status) => onChange({ status })}
          />
          <PriceField
            min={min}
            max={max}
            onMin={(value) => {
              setMin(value);
              onChange({ min: toCents(value) });
            }}
            onMax={(value) => {
              setMax(value);
              onChange({ max: toCents(value) });
            }}
          />
          <div className={styles.popoverActions}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMin("");
                setMax("");
                onChange({ status: "open", min: null, max: null });
              }}
            >
              Reset
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 02.3 Filters sheet: sort, venue, status and price as a draft, applied
 * with "Show N markets" so the count answers before you commit.
 */
export function FiltersSheet({
  open,
  onOpenChange,
  filters,
  markets,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  markets: Market[];
  onApply: (patch: FilterPatch) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const name = useId();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const matches = narrow(markets, {
    venue: draft.venue,
    status: draft.status,
    min: toCents(draft.min),
    max: toCents(draft.max),
  }).length;
  const sorts: [Sort, string][] = [
    ["Trending", "Trending"],
    ["Volume", "Volume"],
    ["Closing soon", "Closing"],
  ];
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (value) setDraft(draftOf(filters));
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content className={styles.sheet} aria-describedby={undefined}>
          <div className={styles.grabber} aria-hidden="true" />
          <header className={styles.sheetHead}>
            <Dialog.Title className={styles.sheetTitle}>Filters</Dialog.Title>
            <button
              className="btn btn-ghost"
              onClick={() => setDraft(DEFAULTS)}
            >
              Reset
            </button>
          </header>
          <div className={styles.sheetBody}>
            <fieldset className={styles.group}>
              <legend className={styles.label}>Sort</legend>
              <div className={`seg ${styles.seg}`} data-indicator="pill">
                {sorts.map(([value, text]) => (
                  <button
                    key={value}
                    className="seg-opt"
                    aria-pressed={draft.sort === value}
                    onClick={() => set({ sort: value })}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.group}>
              <legend className={styles.label}>Venue</legend>
              <div className={`seg ${styles.seg}`} data-indicator="pill">
                {VENUES.map((value) => (
                  <button
                    key={value}
                    className="seg-opt"
                    aria-pressed={draft.venue === value}
                    onClick={() => set({ venue: value })}
                  >
                    {value === "All" ? value : venueName(value)}
                  </button>
                ))}
              </div>
            </fieldset>
            <StatusField
              name={`${name}-status`}
              value={draft.status}
              onChange={(status) => set({ status })}
            />
            <PriceField
              min={draft.min}
              max={draft.max}
              onMin={(min) => set({ min })}
              onMax={(max) => set({ max })}
            />
            <button
              className={`btn btn-primary btn-split ${styles.apply}`}
              onClick={() => {
                onApply({
                  sort: draft.sort,
                  venue: draft.venue,
                  status: draft.status,
                  min: toCents(draft.min),
                  max: toCents(draft.max),
                });
                onOpenChange(false);
              }}
            >
              <span>
                Show {matches.toLocaleString()} market{matches === 1 ? "" : "s"}
              </span>
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
