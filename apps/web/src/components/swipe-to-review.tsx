"use client";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowRight } from "./icons";
import styles from "./swipe-to-review.module.css";

/**
 * The design system's slide-to-review track: drag past 85% of the travel to
 * continue — from the knob or anywhere on the bar. A tap nudges the knob to
 * teach the gesture; Enter or Space on the focused knob continues directly.
 */
export function SwipeToReview({
  disabled,
  onComplete,
  label = "Slide to review order",
  blockedLabel = "Fix the amount to continue",
}: {
  disabled: boolean;
  onComplete: () => void;
  label?: string;
  blockedLabel?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x0: number;
    max: number;
    latest: number;
    moved: boolean;
  } | null>(null);
  const [x, setX] = useState(0);
  // The knob's travel, measured when a drag starts; drives the label fade.
  const [travel, setTravel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const max = () => Math.max(0, (track.current?.offsetWidth ?? 368) - 52);
  const finish = () => {
    if (done.current || disabled) return;
    done.current = true;
    const end = max();
    setTravel(end);
    setX(end);
    timer.current = setTimeout(onComplete, 160);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || done.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x0: event.clientX - x,
      max: max(),
      latest: x,
      moved: false,
    };
    setTravel(drag.current.max);
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = Math.min(d.max, Math.max(0, event.clientX - d.x0));
    if (Math.abs(next) > 3) d.moved = true;
    d.latest = next;
    setX(next);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    // Read the drag's own record: the last move may not have rendered yet.
    if (d.latest >= d.max * 0.85 && !disabled) finish();
    else if (!d.moved) {
      // A tap teaches the gesture: the knob hints the direction.
      setX(28);
      timer.current = setTimeout(() => setX(0), 200);
    } else setX(0);
  };
  const progress = travel ? x / travel : 0;
  const text = disabled ? blockedLabel : label;
  return (
    <div
      ref={track}
      className={styles.swipe}
      data-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      // The whole bar takes the drag, so you can slide from the words too.
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className={styles.fill} style={{ width: x + 48 }} />
      <span
        className={styles.label}
        style={{ opacity: Math.max(0, 1 - progress * 1.4) }}
        aria-hidden="true"
      >
        {text}
      </span>
      <button
        type="button"
        className={styles.knob}
        style={{ transform: `translateX(${x}px)` }}
        // Not mid-drag: a disabled button stops getting pointer events, and
        // the knob would freeze under your finger.
        disabled={disabled && !dragging}
        aria-label={disabled ? text : `${text} — or press Enter`}
        onClick={(event) => {
          // Keyboard activation reports no pointer detail.
          if (event.detail === 0) finish();
        }}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
