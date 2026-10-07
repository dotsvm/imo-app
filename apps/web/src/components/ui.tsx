"use client";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Bitcoin,
  Landmark,
  Cpu,
  Lock,
  SearchX,
  Vote,
  Rocket,
  CloudLightning,
  Basketball,
  Clapperboard,
  type AppIcon,
} from "@/components/icons";
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Category, Market, Trader } from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import { dataNow } from "@/data/clock";
export function Button({
  children,
  className = "",
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    // Default to "button" so a control inside a form never submits by accident.
    <button
      type="button"
      className={`button ${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function IconButton({
  children,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          // Plain dialogs become sheets on phones; custom layouts keep theirs.
          className={`modal ${className || "modal-sheet"}`}
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <div className="modal-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close dialog">
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Segmented<T extends string>({
  values,
  value,
  onChange,
  label,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {values.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          className={value === item ? "selected" : ""}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
const categoryIcons: Record<Category, AppIcon> = {
  Economics: Landmark,
  Politics: Vote,
  Tech: Cpu,
  Science: Rocket,
  Climate: CloudLightning,
  Sports: Basketball,
  Crypto: Bitcoin,
  Culture: Clapperboard,
};
/** The category glyph the market rows and cards use, per the design system. */
export function CategoryIcon({
  category,
  size = 20,
}: {
  category: Category;
  size?: number;
}) {
  const Icon = categoryIcons[category];
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
/** A line of facts joined by " · ", skipping the missing ones — so an
    empty focus never leaves a dangling separator. */
export const meta = (...parts: (string | number | false | null | undefined)[]) =>
  parts.filter((p) => p !== "" && p !== false && p !== null && p !== undefined).join(" · ");
export function Avatar({
  trader,
  small = false,
  size,
}: {
  trader: Trader;
  small?: boolean;
  size?: number;
}) {
  const px = size ?? (small ? 30 : 36);
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      // Their photo or illustration (ours, from public/avatars); initials on
      // their color only when there's neither. No third-party image service
      // learns who is looking.
      style={{ width: px, height: px, fontSize: Math.max(10, Math.round(px * 0.36)), ...(trader.avatarUrl || !trader.color ? {} : { background: trader.color }) }}
      aria-hidden="true"
      // Drawn by CSS, so initials never join a link's or a row's text.
      data-initials={trader.avatarUrl ? undefined : trader.initials}
    >
      {trader.avatarUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="av"
          alt=""
          src={trader.avatarUrl}
          // Google's photo host refuses some referrers.
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  );
}
export function FollowButton({
  trader,
  compact = false,
}: {
  trader: Trader;
  compact?: boolean;
}) {
  const { state, services } = useDemo();
  const following = state.following.includes(trader.id);
  if (trader.id === "you") return <span className="tag">You</span>;
  // 13.3: Follow · Following · Unfollow while you point at Following.
  return (
    <button
      type="button"
      className={`btn ${following ? "btn-secondary" : "btn-primary"} ${compact ? "btn-sm" : ""} follow-button`}
      data-following={following || undefined}
      aria-pressed={following}
      // Pointing at "Following" swaps in "Unfollow" by hiding the label, which
      // would leave the button nameless: the name stays what it says at rest.
      aria-label={following ? "Following" : "Follow"}
      onClick={() => services.profiles.toggleFollow(trader.id)}
    >
      {/* Keyed by state, so the new word rolls in when you tap. */}
      <span className="follow-idle roll" data-dir="up" key={following ? "on" : "off"}>
        {following ? "Following" : "Follow"}
      </span>
      {following && (
        <span className="follow-hover" aria-hidden="true">
          Unfollow
        </span>
      )}
    </button>
  );
}
/** A page that's yours alone, seen signed out: what it's for, and the way in. */
export function SignInWall({ title, description }: { title: string; description: string }) {
  const { services } = useDemo();
  return (
    <Empty
      icon={Lock}
      title={title}
      description={description}
      action={
        <Button variant="primary" onClick={() => services.auth.prompt()}>
          Log in or sign up
        </Button>
      }
    />
  );
}
export function Empty({
  title = "A fresh perspective is waiting",
  description = "Try adjusting your filters to discover more markets.",
  action,
  icon: Icon = SearchX,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: AppIcon;
  className?: string;
}) {
  return (
    <div className={`empty-state ${className}`}>
      <Icon size={24} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="page-content" role="status" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="market-grid">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="skeleton skeleton-card" />
        ))}
      </div>
      <span className="sr-only">Loading your perspective…</span>
    </div>
  );
}
/** The demo's fixed "now" — every seeded timestamp is relative to this. */
/**
 * Relative age against the demo snapshot, so seeded posts read "6m" rather
 * than drifting with the wall clock. Anything written during the session is
 * newer than the snapshot and simply reads "now".
 */
export function relativeTime(at: string) {
  const written = Date.parse(at);
  const reference = Math.max(dataNow(), written);
  const minutes = Math.round((reference - written) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return timeLabel(at);
}
export function timeLabel(at: string) {
  const date = new Date(at);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
export function closeLabel(market: Market) {
  return market.status === "resolved"
    ? "Resolved"
    : `Closes ${timeLabel(market.closesAt)}`;
}
