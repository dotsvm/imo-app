"use client";
/**
 * Small motion helpers. The motion itself lives in CSS (globals.css, "Motion")
 * and only runs for people who haven't asked for less; these hooks just tell
 * it where things are and what changed.
 */
import { useEffect, useState, type ReactNode } from "react";

const SELECTED = '[aria-pressed="true"], [aria-selected="true"], [aria-current]:not([aria-current="false"]), .is-active';

/** Keep one element's sliding selection under its selected child. */
function track(el: HTMLElement) {
  let frame = 0;
  const place = () => {
    const active = el.querySelector<HTMLElement>(`:scope > :is(${SELECTED}), :scope > * > :is(${SELECTED})`);
    if (!active) {
      el.style.setProperty("--ind-o", "0");
      return;
    }
    el.style.setProperty("--ind-x", `${active.offsetLeft}px`);
    el.style.setProperty("--ind-y", `${active.offsetTop}px`);
    el.style.setProperty("--ind-w", `${active.offsetWidth}px`);
    el.style.setProperty("--ind-h", `${active.offsetHeight}px`);
    el.style.setProperty("--ind-o", "1");
    // The first placement lands without travelling from the corner.
    if (!("indReady" in el.dataset)) frame = requestAnimationFrame(() => (el.dataset.indReady = ""));
  };
  place();
  const changes = new MutationObserver(place);
  changes.observe(el, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-pressed", "aria-selected", "aria-current", "class"],
  });
  const sizes = new ResizeObserver(place);
  sizes.observe(el);
  return () => {
    cancelAnimationFrame(frame);
    changes.disconnect();
    sizes.disconnect();
  };
}

/**
 * Selections that slide, app-wide: any row of tabs or segmented control
 * marked `data-indicator` ("pill", or "line" for underlined tabs) gets one
 * shape that moves under the selected option, instead of the highlight
 * blinking from one option to the next. Mounted once, in the shell.
 */
export function useIndicators() {
  useEffect(() => {
    const tracked = new Map<HTMLElement, () => void>();
    let frame = 0;
    const scan = () => {
      frame = 0;
      for (const el of document.querySelectorAll<HTMLElement>("[data-indicator]"))
        if (!tracked.has(el)) tracked.set(el, track(el));
      for (const [el, stop] of tracked)
        if (!el.isConnected) {
          stop();
          tracked.delete(el);
        }
    };
    scan();
    const pages = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(scan);
    });
    pages.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      pages.disconnect();
      for (const stop of tracked.values()) stop();
    };
  }, []);
}

/**
 * "up" or "down" for a moment after a number changes (never on first show),
 * for a price that flashes the way it moved.
 */
export function useFlash(value: number | undefined) {
  const [prev, setPrev] = useState(value);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  // What changed since the last render, worked out while rendering.
  if (prev !== value) {
    setPrev(value);
    if (prev !== undefined && value !== undefined)
      setFlash((f) => ({ dir: value > prev ? "up" : "down", n: (f?.n ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [flash]);
  return flash;
}

/** A number that rolls to its new value: up when it grows, down when it shrinks. */
export function Count({ value, children }: { value: number; children?: ReactNode }) {
  const [prev, setPrev] = useState(value);
  const [dir, setDir] = useState<"up" | "down">("up");
  if (prev !== value) {
    setPrev(value);
    setDir(value > prev ? "up" : "down");
  }
  return (
    <span className="roll" key={value} data-dir={dir}>
      {children ?? value.toLocaleString("en-US")}
    </span>
  );
}

/** A price that flashes green or coral as it moves. */
export function Flash({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  const flash = useFlash(value);
  return (
    <span className={className} data-flash={flash?.dir} key={flash ? `${value}-${flash.n}` : undefined}>
      {children}
    </span>
  );
}

/**
 * Toggles you actually touch get `data-touched`, so a pop plays when you
 * like something — not for everything already liked when the page opens.
 */
export function useTouchedToggles() {
  useEffect(() => {
    const mark = (event: Event) => {
      const toggle = (event.target as Element | null)?.closest?.("[aria-pressed]");
      if (toggle instanceof HTMLElement) toggle.dataset.touched = "";
    };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);
}
