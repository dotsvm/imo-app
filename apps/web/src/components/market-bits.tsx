/* Small, shared market marks: the price-move text, the sparkline and the
   venue badge. Home and Discover draw them the same way. */
import { venueDisplay, type VenueId } from "@/data/venues";
import styles from "./market-bits.module.css";

/** The day's move in cents with its direction glyph — never color alone. */
export function changeText(change: number) {
  const cents = Math.round(change * 10) / 10;
  return cents === 0 ? "0¢" : `${cents > 0 ? "▲" : "▼"} ${Math.abs(cents)}¢`;
}
export const changeTone = (change: number) =>
  change > 0 ? "positive" : change < 0 ? "negative" : styles.flat;

/** A price line. It takes its color from the move unless told otherwise. */
export function Spark({
  data,
  change = 0,
  tone,
  viewBox = [120, 28],
  strokeWidth = 1.5,
  className = "",
}: {
  data: number[];
  change?: number;
  tone?: "up" | "down" | "flat";
  viewBox?: [number, number];
  strokeWidth?: number;
  className?: string;
}) {
  const [w, h] = viewBox;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const inset = strokeWidth + 1;
  const d = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const y = h - inset - ((v - min) / span) * (h - inset * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const drawn = tone ?? (change > 0 ? "up" : change < 0 ? "down" : "flat");
  return (
    <svg
      className={`${styles.spark} ${className}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-tone={drawn}
    >
      <path d={d} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The venue's own mark, from the registry: its logo, or its letter on its
    brand color. */
export function VenueBadge({
  venueId,
  className = "",
}: {
  venueId: VenueId;
  className?: string;
}) {
  const { name, mark, logo, color } = venueDisplay(venueId);
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${styles.venue} ${className}`}
      src={logo}
      alt=""
      title={name}
      width={16}
      height={16}
    />
  ) : (
    <span
      className={`${styles.venue} ${styles.mark} ${className}`}
      style={{ background: color }}
      title={name}
    >
      {mark}
    </span>
  );
}
