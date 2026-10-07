"use client";
import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { complement } from "@imo/core/market";
import type { Market } from "@imo/domain/types";
import { SlidersHorizontal } from "@/components/icons";
import { Menu, MenuItem } from "@/components/menu";
import styles from "./market-chart.module.css";
import { dataNow } from "@/data/clock";
import { useDemo } from "@/services/provider";
import type { PricePoint } from "@imo/domain/demo/contracts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const RANGES = ["1D", "1W", "1M", "All"] as const;
export type Range = (typeof RANGES)[number];
/** Each range's span and axis labels; in the design's sample 1W runs
    Sep 19 → Sep 25, as 04.1 does. `depth` is how far the sample's history
    strays from its price. */
const SPANS: Record<
  Range,
  { span: number; ticks: number; depth: number; words: string }
> = {
  "1D": { span: DAY, ticks: 7, depth: 0.4, words: "past day" },
  "1W": { span: 6 * DAY, ticks: 7, depth: 1, words: "past week" },
  "1M": { span: 28 * DAY, ticks: 5, depth: 1.5, words: "past month" },
  All: { span: 120 * DAY, ticks: 5, depth: 2, words: "since listing" },
};
const W = 1000;
/** "$182K": three figures are plenty for a moment's volume. */
const volume = (cents: number) =>
  `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 }).format(cents / 100)}`;

const et = (ms: number, options: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...options,
  });
const hourOf = (ms: number) =>
  et(Math.round(ms / HOUR) * HOUR, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const dayOf = (ms: number) => et(ms, { month: "short", day: "numeric" });
/** "Sep 24 · 10:00 ET", on the hour. */
const stamp = (ms: number) =>
  `${dayOf(Math.round(ms / HOUR) * HOUR)} · ${hourOf(ms)} ET`;

/** A moment on the chart; volume only where the data has it. */
type Point = { yes: number; no: number; at: number; vol?: number };

const tenth = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

/** The venue's own history, ending at the price on screen now. */
function fromHistory(market: Market, history: PricePoint[]): Point[] {
  const points = history.map((p) => ({ at: p.at, yes: tenth(p.yes), no: tenth(100 - p.yes) }));
  const now = Date.now();
  const last = points.at(-1);
  if (last && now - last.at > MINUTE_MS)
    points.push({ at: now, yes: tenth(market.yesPrice), no: tenth(100 - market.yesPrice) });
  return points;
}
const MINUTE_MS = 60_000;

/** The design's sample world: a history drawn from the dataset's sparkline,
    ending at its price, with each step's volume. Deterministic, so the
    chart is the same every visit. */
function sampleHistory(market: Market, range: Range): Point[] {
  const { span, depth } = SPANS[range];
  const n = market.series.length;
  const start = dataNow() - span;
  const scale = (market.volumeCents * 0.04 * span) / (6 * DAY);
  const seed = [...market.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return market.series.map((v, i) => {
    const yes = Math.max(
      1,
      Math.min(99, Math.round(market.yesPrice + (v - market.yesPrice) * depth)),
    );
    const step = Math.abs(v - (market.series[i - 1] ?? v));
    const churn = 0.55 + step * 0.18 + ((i * 7919 + seed) % 13) / 26;
    return {
      yes,
      no: complement(yes),
      at: start + (span * i) / (n - 1),
      vol: Math.round(scale * churn),
    };
  });
}

/**
 * 04.1 · price history: the range, a Yes line with its area and the No
 * line dashed, gridlines every 10¢, and a crosshair that reads out the
 * time, both prices and the volume. Arrow keys walk the same readout.
 */
export function MarketChart({
  market,
  compact = false,
}: {
  market: Market;
  /** 04.2: the phone's short chart, its range picker underneath. */
  compact?: boolean;
}) {
  const [range, setRange] = useState<Range>("1W");
  const [index, setIndex] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [showNo, setShowNo] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const summaryId = useId();
  const { services } = useDemo();
  const sample = !!services.config()?.dataSnapshot;
  const history = sample ? undefined : services.markets.history(market.id, range);
  const points = sample
    ? sampleHistory(market, range)
    : history
      ? fromHistory(market, history)
      : [];
  const n = points.length;
  const status = sample
    ? "ready"
    : history === undefined
      ? "loading"
      : history === null
        ? "unavailable"
        : n < 2
          ? "empty"
          : "ready";
  const H = compact ? 150 : 240;
  const rangePicker = (
    <div
      className={`seg ${styles.ranges}`} data-indicator="pill"
      role="group"
      aria-label="Chart range"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className="seg-opt"
          aria-pressed={range === r}
          onClick={() => {
            setRange(r);
            setIndex(null);
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );

  if (status !== "ready")
    return (
      <div className={styles.chart} data-compact={compact || undefined}>
        {!compact && <div className={styles.controls}>{rangePicker}</div>}
        <div className={styles.frame}>
          <div className={styles.placeholder} style={{ height: H }} role="status">
            {status === "loading"
              ? "Loading price history…"
              : status === "unavailable"
                ? "Price history isn’t available right now."
                : "No price history for this range yet."}
          </div>
        </div>
        {compact && rangePicker}
      </div>
    );
  const withNo = showNo && !compact;
  const values = points.flatMap((p) => (withNo ? [p.yes, p.no] : [p.yes]));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = high - low > 40 ? 20 : 10;
  const lo = Math.max(0, Math.floor((low - 2) / step) * step);
  const hi = Math.min(100, Math.ceil((high + 2) / step) * step);
  const pad = 8;
  // Points sit at their moment in time: real histories have gaps.
  const t0 = points[0].at;
  const t1 = points[n - 1].at;
  const x = (i: number) =>
    t1 > t0 ? ((points[i].at - t0) / (t1 - t0)) * W : (i / (n - 1)) * W;
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - pad * 2);
  const line = (key: "yes" | "no") =>
    points
      .map(
        (p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`,
      )
      .join(" ");
  const yesPath = line("yes");
  const area = `${yesPath} L${W} ${H} L0 ${H} Z`;
  const ticks: number[] = [];
  for (let v = hi; v >= lo; v -= step) ticks.push(v);
  const { span, ticks: count, words } = SPANS[range];
  const labels = Array.from({ length: count }, (_, i) => {
    const at = sample
      ? dataNow() - span + (span * i) / (count - 1)
      : t0 + ((t1 - t0) * i) / (count - 1);
    return range === "1D" ? hourOf(at) : dayOf(at);
  });
  const active = index ?? (focused ? n - 1 : null);
  const point = points[active ?? n - 1];
  const readout = (p: Point) =>
    `${stamp(p.at)}: Yes ${p.yes}¢, No ${p.no}¢${p.vol === undefined ? "" : `, volume ${volume(p.vol)}`}`;
  const first = points[0];
  const summary = `Yes price over the ${words}: from ${first.yes}¢ to ${points[n - 1].yes}¢, high ${Math.max(...points.map((p) => p.yes))}¢, low ${Math.min(...points.map((p) => p.yes))}¢.`;
  // Volume bars only where the history carries volume (the sample does).
  const volumes = points.every((p) => p.vol !== undefined);
  const maxVol = volumes ? Math.max(...points.map((p) => p.vol ?? 0), 1) : 1;
  const pct = (i: number) => (x(i) / W) * 100;

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    for (let i = 1; i < n; i++)
      if (Math.abs(x(i) - at) < Math.abs(x(nearest) - at)) nearest = i;
    setIndex(nearest);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const now = active ?? n - 1;
    const next =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? now - 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? now + 1
          : event.key === "PageDown"
            ? now - 6
            : event.key === "PageUp"
              ? now + 6
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? n - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    setIndex(Math.max(0, Math.min(n - 1, next)));
  };

  return (
    <div className={styles.chart} data-compact={compact || undefined}>
      {!compact && (
        <div className={styles.controls}>
          {rangePicker}
          <span className={styles.legend}>
            <span className={styles.swatch} data-line="yes" />
            Yes
          </span>
          {withNo && (
            <span className={styles.legend} data-no>
              <span className={styles.swatch} data-line="no" />
              No
            </span>
          )}
          <span className={styles.flex} />
          <span className={styles.note}>Price in ¢ = implied probability</span>
          <Menu
            label="Chart settings"
            triggerClassName={`btn btn-secondary btn-icon ${styles.settings}`}
            trigger={<SlidersHorizontal size={15} />}
          >
            <MenuItem
              kind="checkbox"
              checked={showNo}
              onSelect={() => setShowNo(!showNo)}
            >
              No price line
            </MenuItem>
            {volumes && (
              <MenuItem
                kind="checkbox"
                checked={showVolume}
                onSelect={() => setShowVolume(!showVolume)}
              >
                Volume bars
              </MenuItem>
            )}
          </Menu>
        </div>
      )}

      <div className={styles.frame}>
        <div
          className={styles.plot}
          style={{ height: H }}
          role="slider"
          tabIndex={0}
          aria-label={`Price history, ${words}`}
          aria-describedby={summaryId}
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={active ?? n - 1}
          aria-valuetext={readout(point)}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setIndex(null)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setIndex(null);
          }}
        >
          {!compact &&
            ticks.map((v) => (
              <span
                key={v}
                className={styles.grid}
                style={{ top: `${(y(v) / H) * 100}%` }}
              />
            ))}
          {showVolume && volumes && !compact && (
            <svg
              className={styles.volume}
              viewBox={`0 0 ${W} 40`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {points.map((p, i) => (
                <rect
                  key={i}
                  x={x(i) - 7}
                  width={14}
                  y={40 - ((p.vol ?? 0) / maxVol) * 40}
                  height={((p.vol ?? 0) / maxVol) * 40}
                />
              ))}
            </svg>
          )}
          {/* Keyed by range: each range draws itself in, left to right. */}
          <svg
            key={range}
            className={`${styles.lines} draw`}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={area} className={styles.area} />
            {withNo && <path d={line("no")} className={styles.no} />}
            <path d={yesPath} className={styles.yes} />
          </svg>
          {active !== null ? (
            <>
              <span
                className={styles.cross}
                style={{ left: `${pct(active)}%` }}
              />
              <span
                className={styles.dot}
                style={{
                  left: `${pct(active)}%`,
                  top: `${(y(point.yes) / H) * 100}%`,
                }}
              />
              <span
                className={styles.tip}
                data-flip={pct(active) > 66 || undefined}
                style={
                  pct(active) > 66
                    ? { right: `calc(${100 - pct(active)}% + 8px)` }
                    : { left: `calc(${pct(active)}% + 8px)` }
                }
                aria-hidden="true"
              >
                <b>{stamp(point.at)}</b>
                <span>
                  Yes {point.yes}¢ · No {point.no}¢
                </span>
                {point.vol !== undefined && <span>Vol {volume(point.vol)}</span>}
              </span>
            </>
          ) : (
            <span
              className={styles.dot}
              data-live
              style={{
                left: "100%",
                top: `${(y(points[n - 1].yes) / H) * 100}%`,
              }}
            />
          )}
          <p id={summaryId} className="sr-only">
            {summary}
          </p>
        </div>
        {!compact && (
          <div className={styles.axis} aria-hidden="true">
            {ticks.map((v) => (
              <span key={v} style={{ top: `${(y(v) / H) * 100}%` }}>
                {v}¢
              </span>
            ))}
          </div>
        )}
        {!compact && (
          <div className={styles.times} aria-hidden="true">
            {labels.map((label, i) => (
              <span key={`${label}-${i}`}>{label}</span>
            ))}
          </div>
        )}
      </div>
      {compact && rangePicker}
    </div>
  );
}
