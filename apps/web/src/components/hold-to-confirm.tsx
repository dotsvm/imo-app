"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./hold-to-confirm.module.css";

/**
 * 05.2 "Place order · hold to confirm": the fill runs while the button is
 * held and the action fires when it completes; letting go early cancels.
 * Space or Enter hold the same way. Assistive technology, which activates
 * with a single synthetic click, confirms directly.
 */
export function HoldToConfirm({
  children,
  label,
  onConfirm,
  disabled = false,
  duration = 700,
  className = "",
}: {
  children: ReactNode;
  /** The accessible name; the hold instruction is appended to it. */
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  duration?: number;
  className?: string;
}) {
  const [holding, setHolding] = useState(false);
  // Let go too soon: a small shake says "keep holding".
  const [nudge, setNudge] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keyDown = useRef(false);
  const fired = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(nudgeTimer.current);
    },
    [],
  );
  const start = () => {
    if (disabled) return;
    clearTimeout(timer.current);
    fired.current = false;
    setNudge(false);
    setHolding(true);
    timer.current = setTimeout(() => {
      fired.current = true;
      setHolding(false);
      onConfirm();
    }, duration);
  };
  const stop = () => {
    clearTimeout(timer.current);
    if (holding && !fired.current) {
      setNudge(true);
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => setNudge(false), 450);
    }
    setHolding(false);
  };
  const isKey = (key: string) => key === " " || key === "Enter";
  return (
    <button
      type="button"
      className={`${styles.hold} ${className}`}
      data-holding={holding || undefined}
      data-nudge={nudge || undefined}
      style={{ "--hold": `${duration}ms` } as React.CSSProperties}
      disabled={disabled}
      aria-label={`${label} — press and hold to confirm`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      // A long press on Android opens the context menu, which cancels the
      // hold before it can finish.
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!isKey(event.key)) return;
        // Holding the key is the gesture, so the browser's own click on
        // Enter or Space is replaced by the timer.
        event.preventDefault();
        if (event.repeat) return;
        keyDown.current = true;
        start();
      }}
      onKeyUp={(event) => {
        if (!isKey(event.key)) return;
        keyDown.current = false;
        stop();
      }}
      onBlur={stop}
      onClick={(event) => {
        if (event.detail === 0 && !keyDown.current && !holding) onConfirm();
      }}
    >
      <span className={styles.progress} aria-hidden="true" />
      {children}
    </button>
  );
}
