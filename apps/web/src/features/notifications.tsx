"use client";
/* 15 · Notifications. 15.1: the inbox, filtered by kind, beside the
   preference matrix and price alerts; each column scrolls on its own.
   15.2: on a phone, the inbox alone under its own title bar. */
import Link from "next/link";
import { useState } from "react";
import {
  BellOff,
  CaretLeft,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleX,
  Flag,
  MessageSquare,
  Plus,
  TrendingUp,
  UserPlus,
  Users,
} from "@/components/icons";
import { useDemo, useLoadingView } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import type { Notification, NotificationKind } from "@imo/domain/types";
import { SignInWall, timeLabel } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import styles from "./notifications.module.css";
import { venueName } from "@/data/venues";

const filters: { label: string; kinds: NotificationKind[] | null }[] = [
  { label: "All", kinds: null },
  { label: "Orders", kinds: ["Order"] },
  { label: "Resolutions", kinds: ["Resolution"] },
  { label: "Social", kinds: ["Reply", "Follow"] },
  { label: "Rooms", kinds: ["Room"] },
  { label: "Prices", kinds: ["Price"] },
];
const icons = {
  filled: CircleCheck,
  partial: CircleDashed,
  failed: CircleX,
  resolved: Flag,
  reply: MessageSquare,
  follow: UserPlus,
  room: Users,
  price: TrendingUp,
};
const tone: Record<Notification["icon"], string> = {
  filled: "positive",
  partial: "warning",
  failed: "negative",
  resolved: "positive",
  reply: "",
  follow: "",
  room: "",
  price: "",
};

function useInbox() {
  const { state, services } = useDemo();
  const [filter, setFilter] = useState("All");
  const active = filters.find((f) => f.label === filter) ?? filters[0];
  const unread = state.notifications.filter(
    (n) => !state.readNotifications.includes(n.id),
  ).length;
  const items = state.notifications.filter(
    (n) => !active.kinds || active.kinds.includes(n.kind),
  );
  return {
    filter,
    setFilter,
    unread,
    items,
    isUnread: (n: Notification) => !state.readNotifications.includes(n.id),
    read: (n: Notification) => services.notifications.markRead(n.id),
    readAll: () => services.notifications.markAllRead(),
  };
}

export function Notifications() {
  const { state } = useDemo();
  if (state.signedOut)
    return <SignInWall title="Your notifications" description="Log in to hear about fills, replies, follows and price alerts." />;
  return <NotificationsPage />;
}

function NotificationsPage() {
  const phone = useMediaQuery("(max-width: 600px)");
  const loading = useLoadingView();
  const inbox = useInbox();
  if (loading) return <NotificationsLoading phone={phone} />;
  return phone ? <Phone inbox={inbox} /> : <Desktop inbox={inbox} />;
}

const LOADING_ITEMS = [190, 150, 220, 130, 170, 200];

function FiltersLoading() {
  return (
    <div className={styles.filters} aria-hidden="true">
      {[30, 48, 78, 50, 48, 46].map((w, i) => (
        <Bone key={i} w={w + 24} h={30} r="pill" />
      ))}
    </div>
  );
}

/** The inbox, then what reaches you, while both load. */
function NotificationsLoading({ phone }: { phone: boolean }) {
  if (phone)
    return (
      <Loading label="Loading notifications" className={styles.phone}>
        <header className={styles.phoneHead}>
          <Bone circle={36} />
          <h1>Notifications</h1>
          <Bone w={60} h={14} />
        </header>
        <FiltersLoading />
        <div className={styles.phoneList}>
          {LOADING_ITEMS.map((w, i) => (
            <div key={i} className={styles.phoneRow}>
              <Bone circle={34} />
              <span className={styles.phoneText}>
                <span className={styles.phoneTop}>
                  <Bone w={w - 40} h={12} />
                  <Bone w={34} h={9} />
                </span>
                <BoneLines lines={i % 3 ? 1 : 2} h={10} last="70%" />
              </span>
            </div>
          ))}
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading notifications" className={styles.page}>
      <section className={styles.list}>
        <header className={styles.heading}>
          <h1>Notifications</h1>
          <Bone w={58} h={11} />
          <Bone w={132} h={34} r="pill" />
        </header>
        <FiltersLoading />
        {LOADING_ITEMS.map((w, i) => (
          <div key={i} className={styles.item}>
            <span className={styles.dot} aria-hidden="true" />
            <Bone circle={34} />
            <div className={styles.itemBody}>
              <div className={styles.itemHead}>
                <Bone w={w} h={12} />
                <Bone w={52} h={18} r={6} />
              </div>
              <BoneLines lines={1} h={10} last={`${40 + (i % 3) * 15}%`} />
            </div>
            <div className={styles.itemSide}>
              <Bone w={38} h={10} />
            </div>
          </div>
        ))}
      </section>
      <aside className={styles.aside}>
        <header className={styles.asideHead}>
          <h2>Preferences</h2>
          <Bone w={70} h={11} />
        </header>
        <div className={styles.prefHead} aria-hidden="true">
          <span>Event</span>
          <span>In-app</span>
          <span>Email</span>
        </div>
        {[120, 104, 112, 128, 116, 96, 138, 100].map((w, i) => (
          <div key={i} className={styles.pref}>
            <span>
              <Bone w={w} h={11} />
              <Bone w={w + 30} h={9} style={{ marginTop: 6 }} />
            </span>
            <Bone w={34} h={20} r="pill" />
            <Bone w={34} h={20} r="pill" />
          </div>
        ))}
      </aside>
    </Loading>
  );
}

type Inbox = ReturnType<typeof useInbox>;

function Filters({ inbox }: { inbox: Inbox }) {
  return (
    <div
      className={styles.filters} data-indicator="pill"
      role="group"
      aria-label="Filter notifications"
    >
      {filters.map((f) => (
        <button
          key={f.label}
          type="button"
          aria-pressed={inbox.filter === f.label}
          onClick={() => inbox.setFilter(f.label)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function Nothing({ inbox }: { inbox: Inbox }) {
  return (
    <div className={styles.empty}>
      <BellOff size={24} />
      {inbox.filter === "All" ? (
        <>
          <strong>No notifications yet</strong>
          <p>Fills, replies, follows and price alerts show up here.</p>
        </>
      ) : (
        <>
          <strong>Nothing here</strong>
          <p>No notifications in this filter.</p>
        </>
      )}
      {inbox.filter !== "All" && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => inbox.setFilter("All")}
        >
          Show all
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- 15.1 desktop */
function Desktop({ inbox }: { inbox: Inbox }) {
  return (
    <div className={styles.page}>
      <section className={styles.list} aria-labelledby="inbox-title">
        <header className={styles.heading}>
          <h1 id="inbox-title">Notifications</h1>
          <span>{inbox.unread} unread</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={inbox.readAll}
            disabled={!inbox.unread}
          >
            <CheckCheck size={15} />
            Mark all read
          </button>
        </header>
        <Filters inbox={inbox} />
        {inbox.items.map((n) => {
          const Icon = icons[n.icon];
          const unread = inbox.isUnread(n);
          return (
            <article
              key={n.id}
              className={`${styles.item} rise`}
              data-unread={unread || undefined}
            >
              <span className={styles.dot} aria-hidden="true" />
              <span className={`${styles.icon} ${styles[tone[n.icon]] ?? ""}`}>
                <Icon size={17} />
              </span>
              <div className={styles.itemBody}>
                <div className={styles.itemHead}>
                  {/* The whole row opens it, and opening reads it. */}
                  <Link
                    href={n.href}
                    className={styles.itemLink}
                    onClick={() => inbox.read(n)}
                  >
                    {n.title}
                  </Link>
                  <span className={`tag tag-neutral ${styles.kind}`}>
                    {n.kind}
                  </span>
                  {unread && <span className="sr-only">Unread</span>}
                </div>
                <p>{n.body}</p>
                {n.cta && (
                  <Link
                    href={n.cta.href}
                    className={`btn ${n.cta.primary ? "btn-primary" : "btn-secondary"} btn-sm ${styles.cta}`}
                    onClick={() => inbox.read(n)}
                  >
                    {n.cta.label}
                  </Link>
                )}
              </div>
              <div className={styles.itemSide}>
                <time dateTime={n.at}>{timeLabel(n.at)}</time>
                {unread && (
                  <button type="button" onClick={() => inbox.read(n)}>
                    Mark read
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!inbox.items.length && <Nothing inbox={inbox} />}
      </section>
      <Preferences />
    </div>
  );
}

/** 15.1 right column: what reaches you, and where; then price alerts. */
function Preferences() {
  const { state, services } = useDemo();
  const [alertMarket, setAlertMarket] = useState(state.watchlist[0] ?? "");
  const [threshold, setThreshold] = useState("70");
  const [alertError, setAlertError] = useState("");
  const addAlert = () => {
    try {
      services.settings.addAlert({
        marketId: alertMarket,
        outcome: "Yes",
        thresholdCents: Number(threshold),
        direction: "above",
      });
      setAlertError("");
    } catch (e) {
      setAlertError((e as Error).message);
    }
  };
  return (
    <aside className={styles.aside} aria-labelledby="prefs-title">
      <header className={styles.asideHead}>
        <h2 id="prefs-title">Preferences</h2>
        <Link href="/settings#notifications">All settings</Link>
      </header>
      <div className={styles.prefHead} aria-hidden="true">
        <span>Event</span>
        <span>In-app</span>
        <span>Email</span>
      </div>
      {state.settings.notifications.map((pref) => (
        <div className={styles.pref} key={pref.id}>
          <span>
            <strong>{pref.label}</strong>
            <span>{pref.description}</span>
          </span>
          {(["app", "email"] as const).map((channel) => (
            <button
              key={channel}
              type="button"
              role="switch"
              aria-checked={pref[channel]}
              aria-label={`${pref.label} — ${channel === "app" ? "in-app" : "email"}`}
              className={styles.toggle}
              disabled={pref.locked && channel === "app"}
              title={
                pref.locked && channel === "app"
                  ? "Failure alerts stay on so an order never fails silently."
                  : undefined
              }
              onClick={() =>
                services.settings.toggleNotification(pref.id, channel)
              }
            >
              <span />
            </button>
          ))}
        </div>
      ))}
      <div className={styles.alerts}>
        <h3>Price alerts</h3>
        {state.settings.alerts.map((alert) => {
          const market = services.markets.get(alert.marketId);
          return (
            <div className={styles.alert} key={alert.id}>
              <span>
                <strong>{market?.shortTitle ?? alert.marketId}</strong>
                <span>
                  {alert.outcome} crosses {alert.thresholdCents}¢ ·{" "}
                  {market && venueName(market.venueId)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => services.settings.removeAlert(alert.id)}
                aria-label={`Remove alert on ${market?.shortTitle}`}
              >
                Remove
              </button>
            </div>
          );
        })}
        {!state.settings.alerts.length && (
          <p className={styles.noAlerts}>
            No alerts yet. Pick a market and a Yes price to watch for.
          </p>
        )}
        <form
          className={styles.newAlert}
          onSubmit={(e) => {
            e.preventDefault();
            addAlert();
          }}
        >
          <label className="sr-only" htmlFor="alert-market">
            Alert market
          </label>
          <select
            id="alert-market"
            className="input"
            value={alertMarket}
            onChange={(e) => setAlertMarket(e.target.value)}
          >
            {services.markets
              .list()
              .filter((m) => m.status === "open")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortTitle}
                </option>
              ))}
          </select>
          <label className="sr-only" htmlFor="alert-threshold">
            Yes threshold in cents
          </label>
          <input
            id="alert-threshold"
            className="input"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-invalid={!!alertError}
          />
          <button type="submit" className="btn btn-secondary">
            <Plus size={14} />
            New alert
          </button>
        </form>
        {alertError && (
          <p className="field-error" role="alert">
            {alertError}
          </p>
        )}
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------- 15.2 phone */
function Phone({ inbox }: { inbox: Inbox }) {
  return (
    <div className={styles.phone}>
      <header className={styles.phoneHead}>
        <Link
          href="/"
          className={`btn btn-icon ${styles.back}`}
          aria-label="Home"
        >
          <CaretLeft size={20} />
        </Link>
        <h1>Notifications</h1>
        <button
          type="button"
          className={`btn btn-ghost ${styles.readAll}`}
          onClick={inbox.readAll}
          disabled={!inbox.unread}
        >
          Read all
        </button>
      </header>
      <Filters inbox={inbox} />
      <div className={styles.phoneList}>
        {inbox.items.map((n) => {
          const Icon = icons[n.icon];
          const unread = inbox.isUnread(n);
          return (
            <Link
              key={n.id}
              href={n.href}
              className={`${styles.phoneRow} rise`}
              data-unread={unread || undefined}
              onClick={() => inbox.read(n)}
            >
              <span className={`${styles.icon} ${styles[tone[n.icon]] ?? ""}`}>
                <Icon size={17} />
              </span>
              <span className={styles.phoneText}>
                <span className={styles.phoneTop}>
                  <b>{n.title}</b>
                  <time dateTime={n.at}>{timeLabel(n.at)}</time>
                </span>
                <span>{n.body}</span>
                {unread && <span className="sr-only">Unread</span>}
              </span>
            </Link>
          );
        })}
        {!inbox.items.length && <Nothing inbox={inbox} />}
        <Link href="/settings#notifications" className={styles.phoneSettings}>
          Notification settings
        </Link>
      </div>
    </div>
  );
}
