"use client";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { Check } from "./icons";
import styles from "./menu.module.css";

const ITEM =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * A small popover menu: a trigger button and a list of actions. Arrow keys
 * move between items, Escape and outside clicks close it, and focus returns
 * to the trigger.
 */
export function Menu({
  label,
  trigger,
  children,
  align = "end",
  className = "",
  triggerClassName = "",
}: {
  /** Accessible name for the trigger and the list. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(list.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
    items()[0]?.focus();
    const close = (restore: boolean) => {
      setOpen(false);
      if (restore) button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target))
        close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      const all = items();
      const index = all.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        all[(index + 1) % all.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        all[(index - 1 + all.length) % all.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        all[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        all[all.length - 1]?.focus();
      } else if (event.key === "Tab") {
        close(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const onListClick = (event: MouseEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest(ITEM);
    // A checkbox toggles in place, so several can be set in one visit.
    if (item && item.getAttribute("role") !== "menuitemcheckbox") {
      setOpen(false);
      button.current?.focus();
    }
  };
  return (
    <div className={`${styles.menu} ${className}`}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={styles.list}
          data-align={align}
          onClick={onListClick}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  icon,
  href,
  onSelect,
  tone,
  checked,
  kind = "radio",
}: {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  tone?: "negative";
  /** Set for choices: the item becomes a menu radio, or a checkbox. */
  checked?: boolean;
  kind?: "radio" | "checkbox";
}) {
  const content = (
    <>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {checked && (
        <span className={styles.check} aria-hidden="true">
          <Check size={14} />
        </span>
      )}
    </>
  );
  return href ? (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      className={styles.item}
      data-tone={tone}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      role={
        checked === undefined
          ? "menuitem"
          : kind === "checkbox"
            ? "menuitemcheckbox"
            : "menuitemradio"
      }
      aria-checked={checked}
      tabIndex={-1}
      className={styles.item}
      data-tone={tone}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className={styles.separator} />;
}
