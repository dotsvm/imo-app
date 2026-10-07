"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDemo } from "@/services/provider";
import { Bone } from "./skeleton";
import { arrowUsd, tone } from "@imo/domain/money";
import type { Trader } from "@imo/domain/types";
import styles from "./ticker.module.css";

/** Seconds each trader stays in the loop; sets a calm, readable pace. */
const SECONDS_PER_TRADER = 4;

function Group({ traders, copy }: { traders: Trader[]; copy?: boolean }) {
  return (
    <div className={styles.group} aria-hidden={copy || undefined} data-group={copy ? undefined : true}>
      {traders.map((trader) => {
        const pnl = trader.stats["30D"].pnlCents;
        return (
          <Link
            key={trader.id}
            href={`/trader/${trader.id}`}
            tabIndex={copy ? -1 : undefined}
          >
            <b>@{trader.handle}</b>
            <span className={tone(pnl)}>
              {arrowUsd(pnl)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The ticker strip: a live, endlessly moving line of top-trader P&L that
 * keeps the social pulse visible — under the search bar on desktop, under
 * the tabs on the phone feed. It pauses on hover, on keyboard focus and from
 * its live dot, and holds still for people who prefer reduced motion.
 */
export function TraderTicker({
  variant = "topbar",
  className = "",
}: {
  variant?: "topbar" | "feed";
  className?: string;
}) {
  const { services, ready } = useDemo();
  const [paused, setPaused] = useState(false);
  // A short list sits still: it only loops once it's wider than the strip,
  // so two names never chase their own copies across an empty bar.
  const track = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);
  const leaders = services.profiles
    .list()
    .filter((t) => t.id !== "you")
    .toSorted((a, b) => b.stats["30D"].pnlCents - a.stats["30D"].pnlCents)
    .slice(0, variant === "feed" ? 12 : 20);
  const names = leaders.map((t) => t.id).join();
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const group = el.querySelector<HTMLElement>("[data-group]");
      setLoop(!!group && group.scrollWidth > el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [names, ready]);
  return (
    <section
      className={`${styles.ticker} ${className}`}
      data-variant={variant}
      data-paused={paused || undefined}
      aria-label="Top traders, 30-day P&L"
    >
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={paused}
        aria-label={paused ? "Play the ticker" : "Pause the ticker"}
        title={paused ? "Play" : "Pause"}
        onClick={() => setPaused((value) => !value)}
      >
        <span className={styles.live} aria-hidden="true" />
        {variant === "topbar" && <span>Top 30D</span>}
      </button>
      {!ready ? (
        // The boards load before the app opens: until then, their shape —
        // never a line of people at $0.00.
        <div className={styles.track} aria-hidden="true">
          <div className={styles.group}>
            {[58, 46, 64, 52, 70, 48, 60, 54, 66, 50].map((w, i) => (
              <span key={i} className={styles.loadingItem}>
                <Bone w={w} h={10} />
                <Bone w={72} h={10} />
              </span>
            ))}
          </div>
        </div>
      ) : !leaders.length ? (
        <p className={styles.empty}>
          Top traders show here once people start trading.
        </p>
      ) : (
        <div className={styles.track} ref={track} data-still={!loop || undefined}>
          <div
            className={styles.marquee}
            style={
              {
                "--ticker-duration": `${leaders.length * SECONDS_PER_TRADER}s`,
              } as CSSProperties
            }
          >
            <Group traders={leaders} />
            {/* The second copy closes the loop seamlessly; it is hidden from
              assistive technology and the tab order. */}
            {loop && <Group traders={leaders} copy />}
          </div>
        </div>
      )}
    </section>
  );
}
