/**
 * Loading placeholders. A page draws them in its own layout (its own grid,
 * columns and gutters), so nothing moves when the content arrives; the
 * blocks share one slow sweep of light. No spinners for whole pages.
 */
import type { CSSProperties, ReactNode } from "react";

/** One placeholder block: a line of text, a figure, a pill or an avatar. */
export function Bone({
  w,
  h,
  r,
  circle,
  className,
  style,
}: {
  /** Width: px, or any CSS length ("62%"). */
  w?: number | string;
  /** Height in px (10 = a line of small text). */
  h?: number;
  /** Corner radius; "pill" for a fully rounded control. */
  r?: number | "pill";
  /** A circle this many px across (an avatar). */
  circle?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={className ? `bone ${className}` : "bone"}
      style={{
        ...(circle ? { width: circle, height: circle, borderRadius: "50%" } : { width: w, height: h }),
        ...(r !== undefined && { borderRadius: r === "pill" ? 999 : r }),
        ...style,
      }}
    />
  );
}

/** Lines of text: the last one shorter, as paragraphs end. */
export function BoneLines({ lines = 2, h = 10, gap = 8, last = "60%" }: { lines?: number; h?: number; gap?: number; last?: string }) {
  return (
    <span className="bone-lines" style={{ gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} w={i === lines - 1 ? last : "100%"} h={h} />
      ))}
    </span>
  );
}

/** The page's loading state: announced once, the shapes hidden from readers. */
export function Loading({
  label,
  className,
  children,
}: {
  /** What's loading, for screen readers ("Loading the leaderboard"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} role="status" aria-label={label} aria-busy="true">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
