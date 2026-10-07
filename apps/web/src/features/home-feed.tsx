"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowClockwise,
  ArrowUpRight,
  BookmarkSimple,
  CaretDown,
  ChartBar,
  DotsSixVertical,
  DotsThree,
  FunnelSimple,
  Hourglass,
  PencilSimpleLine,
  RotateCcw,
  SquareSplitHorizontal,
  TrendUp,
  Trophy,
  Users,
  UsersThree,
  WifiSlash,
} from "@/components/icons";
import { Avatar, CategoryIcon, Empty, meta } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import {
  changeText,
  changeTone,
  Spark,
  VenueBadge,
} from "@/components/market-bits";
import { TraderTicker } from "@/components/ticker";
import { useDemo, usePreviewState } from "@/services/provider";
import { compactUsd, signedUsd, tone, signedPct } from "@imo/domain/money";
import { accuracy, MIN_SAMPLE } from "@imo/domain/engine";
import type { Category, Outcome, Post, Trader } from "@imo/domain/types";
import { venueIds, venueName, type VenueId } from "@/data/venues";
import { Composer } from "./social";
import { FeedPost } from "./feed-post";
import { BackDrawer } from "./back-drawer";
import { HomeLoading } from "./home-loading";
import { TraderPagination } from "./trader-pagination";
import { useListPagination } from "./use-list-pagination";
import styles from "./home-feed.module.css";
import { Flash } from "@/components/motion";

type Period = "7D" | "30D" | "90D" | "All";
type Rank = "pnl" | "roi" | "accuracy";
type View = "foryou" | "following" | "traders" | "trending";
type Board = "trending" | "active" | "closing";
type Venue = "All" | VenueId;

const CATEGORIES: Category[] = [
  "Economics",
  "Politics",
  "Tech",
  "Science",
  "Climate",
  "Sports",
  "Crypto",
  "Culture",
];
const pick = <T extends string>(
  value: string | null,
  options: readonly T[],
  fallback: T,
): T => (options.includes(value as T) ? (value as T) : fallback);

/* ------------------------------------------------ Panel layout (resizable) */
const LAYOUT_KEY = "hunch-home-layout";
type Side = "left" | "right";
/** A width of `null` keeps the designed default, which scales with the window. */
type Layout = { left: number | null; right: number | null; compact: boolean };
const DEFAULT_LAYOUT: Layout = { left: null, right: null, compact: false };
const MIN_WIDTH = { left: 280, right: 300 };
const MAX_WIDTH = 560;
/** The feed keeps a readable measure however the side panels are dragged. */
const MIN_CENTER = 440;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
function readLayout(): Layout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    const width = (value: unknown, side: Side) =>
      typeof value === "number" && Number.isFinite(value)
        ? clamp(value, MIN_WIDTH[side], MAX_WIDTH)
        : null;
    if (saved && typeof saved === "object")
      return {
        left: width(saved.left, "left"),
        right: width(saved.right, "right"),
        compact: saved.compact === true,
      };
  } catch {
    // Blocked or malformed storage: fall back to the designed widths.
  }
  return DEFAULT_LAYOUT;
}
function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // The layout still applies for this visit.
  }
}

/* --------------------------------------------------------------- Controls */
/**
 * A filter chip that is a native select underneath: it sizes to the chosen
 * label, and keyboard, screen reader and touch behave as platform selects do.
 */
function ChipSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  className?: string;
}) {
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <span className={`${styles.chipSelect} ${className}`}>
      {icon && (
        <span className={styles.chipIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span aria-hidden="true">{current}</span>
      <CaretDown size={12} className={styles.caret} />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </span>
  );
}

function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className={styles.panelHeader}>
      <DotsSixVertical size={16} className={styles.grip} />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Home */
export function HomeFeed() {
  const { state, services } = useDemo();
  const params = useSearchParams();
  const pathname = usePathname();
  // Demo previews: ?state=loading | empty | error.
  const preview = usePreviewState();
  const screen =
    preview === "loading" || preview === "empty" || preview === "error"
      ? preview
      : null;
  const view = pick<View>(
    params.get("tab"),
    ["foryou", "following", "traders", "trending"],
    "foryou",
  );
  const period = pick<Period>(
    params.get("period"),
    ["7D", "30D", "90D", "All"],
    "30D",
  );
  const rank = pick<Rank>(
    params.get("rank"),
    ["pnl", "roi", "accuracy"],
    "pnl",
  );
  const category = pick<Category | "All categories">(
    params.get("category"),
    CATEGORIES,
    "All categories",
  );
  const who = params.get("who") === "following" ? "following" : "all";
  const saved = params.get("saved") === "1";
  const board = pick<Board>(
    params.get("board"),
    ["trending", "active", "closing"],
    "trending",
  );
  const venue = pick<Venue>(params.get("venue"), venueIds, "All");

  const [composer, setComposer] = useState(false);
  const [ticket, setTicket] = useState<{ post: Post; outcome: Outcome } | null>(
    null,
  );
  // One home-wide category: the traders select and the feed chips share it.
  const [feedFilters, setFeedFilters] = useState(
    category !== "All categories" || saved,
  );
  const [venueFilters, setVenueFilters] = useState(venue !== "All");
  const [columns, setColumns] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<Layout>(readLayout);

  /** Filters live in the URL so a view can be shared and survives reloads. */
  function update(patch: Record<string, string | null>) {
    // Native history integrates with useSearchParams and keeps rapid edits.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch))
      if (value === null) next.delete(key);
      else next.set(key, value);
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname,
    );
  }
  const setView = (next: View) =>
    update({ tab: next === "foryou" ? null : next });
  const findTraders = () => {
    setView("traders");
    // Wide layouts already show the panel; take the reader to it.
    requestAnimationFrame(() =>
      document.getElementById("home-traders")?.focus(),
    );
  };

  /* ---- Layout */
  const commitLayout = (next: Layout) => {
    setLayout(next);
    saveLayout(next);
  };
  /** The width a panel is drawn at now: its saved width or the default. */
  const panelWidth = (side: Side) =>
    layout[side] ??
    Math.round(
      columns
        ?.querySelector<HTMLElement>(
          `[data-panel="${side === "left" ? "traders" : "trending"}"]`,
        )
        ?.getBoundingClientRect().width ?? (side === "left" ? 380 : 400),
    );
  const limits = (side: Side) => {
    const width = columns?.clientWidth ?? 1384;
    const other = panelWidth(side === "left" ? "right" : "left");
    return {
      min: MIN_WIDTH[side],
      max: Math.max(
        MIN_WIDTH[side],
        Math.min(MAX_WIDTH, width - other - MIN_CENTER),
      ),
    };
  };
  const startResize = (
    side: Side,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!columns || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const { min, max } = limits(side);
    const x0 = event.clientX;
    const start = panelWidth(side);
    let latest = start;
    handle.dataset.active = "true";
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      latest = clamp(side === "left" ? start + dx : start - dx, min, max);
      // Drag without re-rendering the panels; commit once on release.
      columns.style.setProperty(`--${side}`, `${latest}px`);
    };
    const end = () => {
      delete handle.dataset.active;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (latest !== start) commitLayout({ ...layout, [side]: latest });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const keyResize = (side: Side, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitLayout({ ...layout, [side]: null });
      return;
    }
    const { min, max } = limits(side);
    const step = event.shiftKey ? 48 : 16;
    // Arrows move the divider: left shrinks the traders panel, grows markets.
    const grow = side === "left" ? 1 : -1;
    const current = panelWidth(side);
    const next =
      event.key === "ArrowLeft"
        ? current - step * grow
        : event.key === "ArrowRight"
          ? current + step * grow
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    commitLayout({ ...layout, [side]: clamp(next, min, max) });
  };
  const resetLayout = () =>
    commitLayout({ ...DEFAULT_LAYOUT, compact: layout.compact });

  /* ---- Traders */
  const metric = (t: Trader) =>
    rank === "accuracy"
      ? accuracy(t.stats[period])
      : rank === "roi"
        ? t.stats[period].returnPct
        : t.stats[period].pnlCents;
  const leaders = services.profiles
    .list()
    .filter(
      (t) =>
        t.id !== "you" &&
        (who === "all" || state.following.includes(t.id)) &&
        (category === "All categories" || t.interests.includes(category)),
    )
    .toSorted((a, b) => metric(b) - metric(a));
  const { visible: visibleLeaders, loadMore } = useListPagination(
    leaders,
    `${who}:${category}:${period}:${rank}`,
  );
  const follow = (trader: Trader) => {
    services.profiles.toggleFollow(trader.id);
    // The button leaves with the follow; keep keyboard focus in the row.
    requestAnimationFrame(() =>
      document.getElementById(`leader-${trader.id}`)?.focus(),
    );
  };

  /* ---- Feed */
  const marketOf = (p: Post) => services.markets.get(p.marketId);
  const following = view === "following";
  const posts = state.posts
    .filter(
      (p) =>
        (!following || state.following.includes(p.authorId)) &&
        (!saved || state.bookmarked.includes(p.id)) &&
        (category === "All categories" || marketOf(p)?.category === category),
    )
    .toSorted((a, b) =>
      a.id === params.get("post") ? -1 : b.id === params.get("post") ? 1 : 0,
    );
  // Chips for the categories that have calls, plus the one selected.
  const topics = CATEGORIES.filter(
    (c) =>
      c === category || state.posts.some((p) => marketOf(p)?.category === c),
  );
  const feedFiltered = category !== "All categories" || saved;

  /* ---- Markets */
  const markets = services.markets
    .list()
    .filter(
      (m) =>
        m.status === "open" &&
        (venue === "All" || m.venueId === venue) &&
        (category === "All categories" || m.category === category),
    )
    .toSorted((a, b) =>
      board === "active"
        ? b.volumeCents - a.volumeCents
        : board === "closing"
          ? Date.parse(a.closesAt) - Date.parse(b.closesAt)
          : 0, // trending: the server's own ranking, as the catalog arrives
    );
  const { visible: visibleMarkets, loadMore: loadMoreMarkets } =
    useListPagination(markets, `${category}:${venue}:${board}`);

  if (screen === "loading") return <HomeLoading />;

  const openTicket = (post: Post) => (outcome: Outcome) =>
    setTicket({ post, outcome });

  /* ---- Feed body: error, empty and the list */
  const feedEmpty =
    screen === "empty" ? (
      <FollowingEmpty onFindTraders={findTraders} />
    ) : posts.length === 0 ? (
      saved ? (
        <Empty
          icon={BookmarkSimple}
          title="Nothing saved yet"
          description="Bookmark a prediction to keep its reasoning close. Only you see what you save."
          action={
            <button
              className="btn btn-secondary"
              onClick={() => update({ saved: null })}
            >
              Show all predictions
            </button>
          }
        />
      ) : following && state.following.length === 0 ? (
        <>
          {/* 06.1: the traders panel is right there on desktop. */}
          <Empty
            icon={UsersThree}
            className={styles.wideOnly}
            title="You’re not following anyone yet"
            description="Follow traders on the left to see their predictions here."
          />
          <FollowingEmpty
            className={styles.narrowOnly}
            onFindTraders={findTraders}
          />
        </>
      ) : following ? (
        <FollowingEmpty onFindTraders={findTraders} />
      ) : category === "All categories" ? (
        <Empty
          icon={PencilSimpleLine}
          title="No predictions yet"
          description="Nobody has shared a take yet. Open a market, pick a side and say why."
        />
      ) : (
        <Empty
          icon={FunnelSimple}
          title={`No predictions in ${category}`}
          description="Nobody has shared a take on these markets yet. Try another category, or share the first one."
          action={
            <button
              className="btn btn-secondary"
              onClick={() => update({ category: null })}
            >
              Clear filter
            </button>
          }
        />
      )
    ) : null;

  return (
    <div className={styles.home}>
      <h1 className="sr-only">Your prediction feed</h1>

      {/* 06.2 · phones and tablets switch panels with underline tabs. */}
      <div className={styles.viewTabs}>
        <div
          className={styles.viewTabList} data-indicator="line"
          role="group"
          aria-label="Home views"
        >
          {(
            [
              ["foryou", "For you"],
              ["following", "Following"],
              ["traders", "Traders"],
              ["trending", "Trending"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={view === value}
              onClick={() => setView(value)}
              data-view={value}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`btn btn-icon ${styles.viewFilter}`}
          aria-label="Filter predictions"
          aria-expanded={feedFilters}
          aria-controls="feed-filters"
          data-active={feedFiltered || undefined}
          onClick={() => {
            setFeedFilters((open) => !open);
            if (view === "traders" || view === "trending") setView("foryou");
          }}
        >
          <FunnelSimple size={18} />
        </button>
        <button
          className={`btn btn-secondary btn-sm ${styles.viewCompose}`}
          onClick={() => setComposer(true)}
        >
          <PencilSimpleLine size={14} />
          Share your take
        </button>
      </div>
      <TraderTicker variant="feed" />

      <div
        ref={setColumns}
        className={styles.columns}
        data-view={view}
        data-drawer={ticket ? "open" : undefined}
        style={
          {
            "--left": layout.left === null ? undefined : `${layout.left}px`,
            "--right": layout.right === null ? undefined : `${layout.right}px`,
          } as CSSProperties
        }
      >
        {/* -------------------------------------------------- Traders */}
        <aside
          id="home-traders"
          className={styles.panel}
          data-panel="traders"
          aria-label="Trader leaderboard"
          tabIndex={-1}
        >
          <PanelHeader>
            <ChipSelect
              label="Trader list"
              className={styles.titleSelect}
              icon={
                who === "following" ? <Users size={15} /> : <Trophy size={15} />
              }
              value={who}
              options={[
                ["all", "Top traders"],
                ["following", "Following"],
              ]}
              onChange={(value) =>
                update({ who: value === "all" ? null : value })
              }
            />
            <span className={styles.flex} />
            <button
              className={`btn btn-icon ${styles.tool}`}
              aria-pressed={layout.compact}
              aria-label="Compact rows"
              data-tip={layout.compact ? "Show details" : "Compact rows"}
              onClick={() =>
                commitLayout({ ...layout, compact: !layout.compact })
              }
            >
              <SquareSplitHorizontal size={16} />
            </button>
            <Menu
              label="Trader panel options"
              triggerClassName={`btn btn-icon ${styles.tool}`}
              trigger={<DotsThree size={16} />}
            >
              <MenuItem icon={<ArrowUpRight />} href="/leaderboard">
                Open full leaderboard
              </MenuItem>
              <MenuItem icon={<RotateCcw />} onSelect={resetLayout}>
                Reset panel widths
              </MenuItem>
            </Menu>
          </PanelHeader>
          <div className={styles.filters}>
            <ChipSelect
              label="Rank traders by"
              value={rank}
              options={[
                ["pnl", "P&L"],
                ["roi", "ROI"],
                ["accuracy", "Accuracy"],
              ]}
              onChange={(value) =>
                update({ rank: value === "pnl" ? null : value })
              }
            />
            <ChipSelect
              label="Performance period"
              value={period}
              options={[
                ["7D", "7D"],
                ["30D", "30D"],
                ["90D", "90D"],
                ["All", "All time"],
              ]}
              onChange={(value) =>
                update({ period: value === "30D" ? null : value })
              }
            />
            <ChipSelect
              label="Home category"
              value={category}
              options={[
                ["All categories", "All categories"],
                ...CATEGORIES.map((c) => [c, c] as const),
              ]}
              onChange={(value) =>
                update({ category: value === "All categories" ? null : value })
              }
            />
          </div>
          <div
            className={`${styles.panelBody} ${styles.tradersBody}`}
            data-panel-body
            data-compact={layout.compact || undefined}
          >
            {visibleLeaders.map((trader, i) => {
              const stat = trader.stats[period];
              const low = stat.resolved < MIN_SAMPLE;
              const followed = state.following.includes(trader.id);
              return (
                <div
                  key={trader.id}
                  className={styles.traderRow}
                  data-following={followed || undefined}
                >
                  <b className={styles.rank} data-top={i < 3 || undefined}>
                    {i + 1}
                  </b>
                  <Link
                    href={`/trader/${trader.id}`}
                    className={styles.traderAvatar}
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <Avatar trader={trader} size={34} />
                  </Link>
                  <div className={styles.traderIdentity}>
                    <span className={styles.traderNameRow}>
                      <Link
                        href={`/trader/${trader.id}`}
                        id={`leader-${trader.id}`}
                        className={styles.traderName}
                      >
                        {trader.name}
                      </Link>
                      {!followed && (
                        <button
                          className={`btn btn-primary btn-xs ${styles.followPill}`}
                          aria-label={`Follow ${trader.name}`}
                          onClick={() => follow(trader)}
                        >
                          Follow
                        </button>
                      )}
                    </span>
                    <span
                      className={styles.traderMeta}
                      title={meta(trader.focus, `${accuracy(stat)}% right`, `${stat.resolved} resolved`)}
                    >
                      {trader.focus && <span className={styles.traderFocus}>{trader.focus}</span>}
                      <span className={styles.traderRecord}>
                        {trader.focus && <span className={styles.traderSep}>&nbsp;· </span>}
                        {accuracy(stat)}% right ·{" "}
                        <span data-low={low || undefined}>
                          {stat.resolved} resolved{low && " · low sample"}
                        </span>
                      </span>
                    </span>
                  </div>
                  <div className={styles.traderReturn}>
                    <b className={tone(stat.pnlCents)}>
                      {signedUsd(stat.pnlCents)}
                    </b>
                    <span className={tone(stat.returnPct)}>
                      {signedPct(stat.returnPct)} ROI
                    </span>
                  </div>
                </div>
              );
            })}
            {!leaders.length &&
              (who === "following" && state.following.length === 0 ? (
                <Empty
                  icon={UsersThree}
                  title="No one here yet"
                  description="Traders you follow are ranked here. Switch to Top traders to find a few."
                  action={
                    <button
                      className="btn btn-secondary"
                      onClick={() => update({ who: null })}
                    >
                      Show top traders
                    </button>
                  }
                />
              ) : category === "All categories" ? (
                <Empty
                  icon={Trophy}
                  title="No ranked traders yet"
                  description="The board fills in as people trade and their predictions resolve."
                />
              ) : (
                <Empty
                  icon={Trophy}
                  title={`No traders in ${category}`}
                  description="Nobody in this list trades that category yet."
                  action={
                    <button
                      className="btn btn-secondary"
                      onClick={() => update({ category: null })}
                    >
                      Clear filter
                    </button>
                  }
                />
              ))}
            <TraderPagination
              shown={visibleLeaders.length}
              total={leaders.length}
              onLoadMore={loadMore}
            />
            <p className={styles.note}>
              P&amp;L is net of venue and app fees. “Right” = share of resolved
              predictions that were correct — being right and making money are
              shown separately.
            </p>
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the traders panel"
          aria-controls="home-traders"
          aria-valuenow={panelWidth("left")}
          aria-valuemin={limits("left").min}
          aria-valuemax={limits("left").max}
          tabIndex={0}
          className={styles.resizer}
          data-side="left"
          onPointerDown={(e) => startResize("left", e)}
          onKeyDown={(e) => keyResize("left", e)}
          onDoubleClick={() => commitLayout({ ...layout, left: null })}
        />

        {/* ----------------------------------------------------- Feed */}
        <section
          className={styles.panel}
          data-panel="feed"
          aria-label="Prediction feed"
        >
          <PanelHeader>
            <div
              className={`seg ${styles.feedSeg}`} data-indicator="pill"
              role="group"
              aria-label="Feed"
            >
              <button
                className="seg-opt"
                aria-pressed={view === "foryou" || view === "traders"}
                onClick={() => setView("foryou")}
              >
                For you
              </button>
              <button
                className="seg-opt"
                aria-pressed={view === "following"}
                onClick={() => setView("following")}
              >
                Following · {state.following.length}
              </button>
              <button
                className={`seg-opt ${styles.segTrending}`}
                aria-pressed={view === "trending"}
                onClick={() => setView("trending")}
              >
                Trending
              </button>
            </div>
            <span className={styles.flex} />
            <button
              className={`btn btn-icon ${styles.tool}`}
              aria-label="Filter predictions"
              aria-expanded={feedFilters}
              aria-controls="feed-filters"
              data-active={feedFiltered || undefined}
              data-tip="Filter"
              onClick={() => setFeedFilters((open) => !open)}
            >
              <FunnelSimple size={16} />
            </button>
            <button
              className={`btn btn-secondary btn-sm ${styles.compose}`}
              onClick={() => setComposer(true)}
            >
              <PencilSimpleLine size={14} />
              Share your take
            </button>
          </PanelHeader>
          {feedFilters && (
            <div
              id="feed-filters"
              className={styles.chipRow}
              role="group"
              aria-label="Filter predictions"
            >
              <button
                className="chip"
                aria-pressed={category === "All categories"}
                onClick={() => update({ category: null })}
              >
                All
              </button>
              {topics.map((c) => (
                <button
                  key={c}
                  className="chip"
                  aria-pressed={category === c}
                  onClick={() =>
                    update({ category: category === c ? null : c })
                  }
                >
                  {c}
                </button>
              ))}
              <span className={styles.chipDivider} aria-hidden="true" />
              <button
                className="chip"
                aria-pressed={saved}
                aria-label="Saved predictions"
                onClick={() => update({ saved: saved ? null : "1" })}
              >
                <BookmarkSimple size={13} />
                Saved
              </button>
            </div>
          )}
          <div className={styles.panelBody} data-panel-body>
            {screen === "error" && (
              <div className={styles.feedError} role="alert">
                <WifiSlash size={24} />
                <b>Couldn’t refresh the feed</b>
                <p>
                  Showing posts from 2 minutes ago. Market prices on cards may
                  be stale.
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={() => update({ state: null })}
                >
                  <ArrowClockwise size={15} />
                  Retry
                </button>
              </div>
            )}
            {feedEmpty ?? (
              <div className={styles.posts}>
                {posts.map((post) => (
                  <FeedPost
                    key={post.id}
                    post={post}
                    onTrade={openTicket(post)}
                  />
                ))}
                <p className={styles.feedEnd}>
                  You’re all caught up ·{" "}
                  <button onClick={() => setComposer(true)}>
                    Share your take
                  </button>
                </p>
              </div>
            )}
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the markets panel"
          aria-controls="home-trending"
          aria-valuenow={panelWidth("right")}
          aria-valuemin={limits("right").min}
          aria-valuemax={limits("right").max}
          tabIndex={0}
          className={styles.resizer}
          data-side="right"
          onPointerDown={(e) => startResize("right", e)}
          onKeyDown={(e) => keyResize("right", e)}
          onDoubleClick={() => commitLayout({ ...layout, right: null })}
        />

        {/* ------------------------------------------------- Trending */}
        <aside
          id="home-trending"
          className={styles.panel}
          data-panel="trending"
          aria-label="Trending markets"
        >
          <PanelHeader>
            <ChipSelect
              label="Market list"
              className={styles.titleSelect}
              icon={
                board === "active" ? (
                  <ChartBar size={15} />
                ) : board === "closing" ? (
                  <Hourglass size={15} />
                ) : (
                  <TrendUp size={15} />
                )
              }
              value={board}
              options={[
                ["trending", "Trending"],
                ["active", "Most active"],
                ["closing", "Closing soon"],
              ]}
              onChange={(value) =>
                update({ board: value === "trending" ? null : value })
              }
            />
            <span className={styles.flex} />
            <span className={styles.live}>
              <span aria-hidden="true" />
              Live
            </span>
            <button
              className={`btn btn-icon ${styles.tool}`}
              aria-label="Filter markets by venue"
              aria-expanded={venueFilters}
              aria-controls="market-filters"
              data-active={venue !== "All" || undefined}
              data-tip="Venue"
              onClick={() => setVenueFilters((open) => !open)}
            >
              <FunnelSimple size={16} />
            </button>
          </PanelHeader>
          {venueFilters && (
            <div
              id="market-filters"
              className={styles.chipRow}
              role="group"
              aria-label="Filter markets by venue"
            >
              {(["All", ...venueIds] as const).map((v) => (
                <button
                  key={v}
                  className="chip"
                  aria-pressed={venue === v}
                  onClick={() => update({ venue: v === "All" ? null : v })}
                >
                  {v === "All" ? "All venues" : venueName(v)}
                </button>
              ))}
            </div>
          )}
          <div className={styles.panelBody} data-panel-body>
            {visibleMarkets.map((m) => (
              <Link
                key={m.id}
                href={`/market/${m.id}`}
                className={styles.marketRow}
              >
                <span className={styles.tile}>
                  <CategoryIcon category={m.category} size={16} />
                  <VenueBadge venueId={m.venueId} className={styles.venue} />
                </span>
                <span className={styles.marketText}>
                  <span className={styles.marketName}>{m.shortTitle}</span>
                  <span className={styles.marketMeta}>
                    {venueName(m.venueId)} ·{" "}
                    {board === "closing"
                      ? `closes ${new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
                      : `${compactUsd(m.volumeCents)} vol`}
                  </span>
                </span>
                <Spark
                  data={m.series}
                  change={m.change}
                  strokeWidth={1.4}
                  className={styles.spark}
                />
                <span className={styles.quote}>
                  <Flash value={m.yesPrice}>{m.yesPrice}¢</Flash>
                  <span className={changeTone(m.change)}>
                    {changeText(m.change)}
                  </span>
                </span>
              </Link>
            ))}
            {!markets.length &&
              (venue !== "All" ? (
                <Empty
                  icon={TrendUp}
                  title="No open markets here"
                  description="Every market on this venue has closed. Try another venue."
                  action={
                    <button
                      className="btn btn-secondary"
                      onClick={() => update({ venue: null })}
                    >
                      Show all venues
                    </button>
                  }
                />
              ) : category !== "All categories" ? (
                <Empty
                  icon={TrendUp}
                  title={`No open markets in ${category}`}
                  description="Nothing open in this category right now."
                  action={
                    <button
                      className="btn btn-secondary"
                      onClick={() => update({ category: null })}
                    >
                      Clear filter
                    </button>
                  }
                />
              ) : (
                <Empty
                  icon={TrendUp}
                  title="Markets are on their way"
                  description="Live markets appear here as soon as the first price sync finishes."
                />
              ))}
            {markets.length > 0 && (
              <div className={styles.panelFooter}>
                {visibleMarkets.length < markets.length && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={loadMoreMarkets}
                  >
                    Explore all markets
                  </button>
                )}
                <p
                  role="status"
                  className={
                    visibleMarkets.length < markets.length
                      ? "sr-only"
                      : styles.complete
                  }
                >
                  {visibleMarkets.length < markets.length
                    ? `Showing ${visibleMarkets.length} of ${markets.length} markets`
                    : `All ${markets.length} markets shown`}
                </p>
              </div>
            )}
          </div>
        </aside>

        {ticket && (
          <BackDrawer
            key={`${ticket.post.id}-${ticket.outcome}`}
            post={ticket.post}
            initialOutcome={ticket.outcome}
            container={columns}
            onClose={() => setTicket(null)}
          />
        )}
      </div>

      <button
        className={styles.fab}
        aria-label="Share your take"
        onClick={() => setComposer(true)}
      >
        <PencilSimpleLine size={22} />
      </button>
      <Composer open={composer} onOpenChange={setComposer} />
    </div>
  );
}

/** 06.5 · Following, empty: say why, then two ways forward. */
function FollowingEmpty({
  onFindTraders,
  className = "",
}: {
  onFindTraders: () => void;
  className?: string;
}) {
  return (
    <Empty
      icon={UsersThree}
      className={className}
      title="Your Following feed is empty"
      description="Follow a few traders whose reasoning you trust. Their predictions — wins and losses — show up here."
      action={
        <>
          <button className="btn btn-primary" onClick={onFindTraders}>
            Find traders
          </button>
          <Link href="/rooms" className="btn btn-secondary">
            Browse rooms
          </Link>
        </>
      }
    />
  );
}
