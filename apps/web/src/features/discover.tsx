"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowsDownUp,
  Bank,
  BookmarkSimple,
  Compass,
  FunnelSimple,
  MagnifyingGlass,
  Trophy,
  UsersThree,
} from "@/components/icons";
import { useDemo, usePreviewState } from "@/services/provider";
import { compactUsd, signedUsd, tone } from "@imo/domain/money";
import { accuracy, MIN_SAMPLE } from "@imo/domain/engine";
import type { Market, Trader } from "@imo/domain/types";
import { venueList, venueName } from "@/data/venues";
import { answersInPreview, outageDetail } from "@/data/previews";
import { Avatar, Empty, meta } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { changeText, changeTone, Spark } from "@/components/market-bits";
import {
  CATEGORIES,
  filterCount,
  narrow,
  serverFilters,
  order,
  readFilters,
  SEARCH_RETURN,
  SORTS,
  statusLine,
  VENUES,
  type Filters,
} from "./discover-model";
import {
  MarketListSkeleton,
  MarketRow,
  MarketTableHead,
  OutcomeLinks,
  ResultsError,
} from "./discover-parts";
import {
  FiltersPopover,
  FiltersSheet,
  type FilterPatch,
} from "./discover-filters";
import { DiscoverSearch } from "./discover-search";
import { DiscoverCategory } from "./discover-category";
import styles from "./discover.module.css";
import { Flash } from "@/components/motion";

/** "All", or a venue's name. */
const venueFilterLabel = (v: string) => (v === "All" ? "All" : venueName(v));

const TRENDING_ROWS = 11;

export function Discover() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));
  const stateParam = usePreviewState();
  const preview =
    stateParam === "loading" || stateParam === "error" || stateParam === "empty"
      ? stateParam
      : null;
  const [sheet, setSheet] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { services } = useDemo();
  // A new deployment before its first price sync has nothing to show yet.
  const noMarkets = services.markets.list().length === 0;

  /** Filters live in the URL; defaults are dropped to keep links clean. */
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch))
      if (value === null) next.delete(key);
      else next.set(key, value);
    const query = next.toString();
    // Native history integrates with useSearchParams and keeps rapid edits.
    window.history.replaceState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname,
    );
  }
  const applyFilters = (patch: FilterPatch) =>
    update({
      ...(patch.sort && {
        sort: patch.sort === "Trending" ? null : patch.sort,
      }),
      ...(patch.venue && { venue: patch.venue === "All" ? null : patch.venue }),
      ...(patch.status && {
        status: patch.status === "open" ? null : patch.status,
      }),
      ...("min" in patch && {
        min: patch.min === null ? null : String(patch.min),
      }),
      ...("max" in patch && {
        max: patch.max === null ? null : String(patch.max),
      }),
    });
  const openSearch = () => {
    try {
      sessionStorage.setItem(
        SEARCH_RETURN,
        `${pathname}${window.location.search}`,
      );
    } catch {
      // The way back falls to Discover itself.
    }
    router.push("/discover?q=");
  };
  const exitSearch = () => {
    let back = "/discover";
    try {
      back = sessionStorage.getItem(SEARCH_RETURN) || back;
    } catch {
      // Storage blocked: Discover it is.
    }
    router.push(back.includes("q=") ? "/discover" : back);
  };

  // ---- 03.1 / 03.2 Search ------------------------------------------------
  if (filters.q !== null)
    return (
      <DiscoverSearch
        query={filters.q}
        tab={filters.tab}
        preview={preview}
        onQuery={(q) => update({ q })}
        onTab={(tab) => update({ tab: tab === "All" ? null : tab })}
        onExit={exitSearch}
        onRetry={() => update({ state: null })}
      />
    );

  // ---- 03.3 Category -----------------------------------------------------
  if (filters.category !== "All")
    return (
      <DiscoverCategory
        category={filters.category}
        filters={filters}
        preview={preview}
        onParam={update}
      />
    );

  // ---- 02.1 / 02.2 Discover ----------------------------------------------
  if (noMarkets && !preview)
    return (
      <div className={styles.emptyPage}>
        <Empty
          icon={Compass}
          title="Markets are on their way"
          description="Live markets appear here as soon as the first price sync finishes."
        />
      </div>
    );
  return (
    <DiscoverHome
      filters={filters}
      preview={preview}
      showAll={showAll}
      onShowAll={() => setShowAll(true)}
      onFilters={applyFilters}
      onRetry={() => update({ state: null })}
      onCategory={(c) =>
        router.push(`/discover?category=${encodeURIComponent(c)}`)
      }
      onSearch={openSearch}
      sheet={sheet}
      onSheet={setSheet}
    />
  );
}

function DiscoverHome({
  filters,
  preview,
  showAll,
  onShowAll,
  onFilters,
  onRetry,
  onCategory,
  onSearch,
  sheet,
  onSheet,
}: {
  filters: Filters;
  preview: "loading" | "error" | "empty" | null;
  showAll: boolean;
  onShowAll: () => void;
  onFilters: (patch: FilterPatch) => void;
  onRetry: () => void;
  onCategory: (category: string) => void;
  onSearch: () => void;
  sheet: boolean;
  onSheet: (open: boolean) => void;
}) {
  const { services, state } = useDemo();
  const all = services.markets.list();
  // In the error preview one venue is "down"; the rest still answer.
  const reachable = all.filter((m) => answersInPreview(preview, m.venueId));
  // The server filters and orders every market; what's loaded stands in
  // for the moment it takes.
  const fromServer = services.markets.query(serverFilters(filters));
  const matching =
    preview === "empty"
      ? []
      : fromServer
        ? fromServer.filter((m) => answersInPreview(preview, m.venueId))
        : order(narrow(reachable, filters), filters.sort, all);
  const rows = showAll ? matching : matching.slice(0, TRENDING_ROWS);
  // An editor's pick when there is one; otherwise what's trending most.
  const featured = all.find((m) => m.featured) ?? all[0];
  const holders = (services.markets.holders(featured.id) ?? []).map((h) => h.trader);
  const followedHolders = holders.filter((t) => state.following.includes(t.id));
  const facePile: Trader[] = [
    ...followedHolders,
    ...holders.filter((t) => !state.following.includes(t.id)),
  ].slice(0, 2);
  const comments = state.posts
    .filter((post) => post.marketId === featured.id)
    .reduce((n, post) => n + (post.commentCount ?? post.comments.length) + 1, 0);
  const siblings = all
    .filter((m) => m.category === featured.category && m.id !== featured.id)
    .slice(0, 2);
  const list = state.watchlists[0];
  const watchMarkets = (list?.marketIds ?? [])
    .map((id) => services.markets.get(id))
    .filter((m): m is Market => !!m);
  const topTraders = services.profiles
    .list()
    .filter((t) => t.id !== "you")
    .toSorted((a, b) => b.stats["30D"].pnlCents - a.stats["30D"].pnlCents)
    .slice(0, 4);
  const activeRooms = state.rooms
    .toSorted((a, b) => b.online - a.online)
    .slice(0, 3);
  const others = Math.max(0, holders.length - 1);

  return (
    <div className={styles.discover}>
      {/* 02.1 has no visible title; the rail and topbar carry it. */}
      <h1 className="sr-only">Discover markets</h1>
      <div className={styles.main} data-panel-body>
        {/* 02.2 · phones search from a field at the top of the page. */}
        <button className={styles.searchPill} onClick={onSearch}>
          <MagnifyingGlass size={16} />
          Search markets, traders, rooms
        </button>

        <article className={styles.featured} aria-label="Featured event">
          <div className={styles.featuredBody}>
            <span className={styles.kicker}>
              <span className={`card-kicker ${styles.wide}`}>
                Featured event{featured.featuredLabel ? ` · ${featured.featuredLabel}` : ""}
              </span>
              <span className={`tag tag-neutral ${styles.wide}`}>
                {venueName(featured.venueId)}
              </span>
              <span className={`card-kicker ${styles.narrow}`}>
                Featured · {venueName(featured.venueId)}
              </span>
            </span>
            <h2>
              <Link
                href={`/market/${featured.id}`}
                className={styles.stretched}
              >
                {featured.title}
              </Link>
            </h2>
            {/* No history yet (a market the worker hasn't charted): no line. */}
            {featured.series.length > 1 && (
              <Spark
                data={featured.series}
                change={featured.change}
                viewBox={[280, 56]}
                strokeWidth={2}
                className={styles.featuredSparkPhone}
              />
            )}
            <span className={styles.featuredPrices}>
              <OutcomeLinks market={featured} size="lg" />
              {/* Wraps as one line under the pills, never mid-sentence. */}
              <span className={`${styles.wide} ${styles.featuredStats}`}>
                <b className={changeTone(featured.change)}>
                  {changeText(featured.change)} today
                </b>
                <span className={styles.muted}>
                  · {compactUsd(featured.volumeCents)} vol · {comments} comments
                </span>
              </span>
            </span>
            <span className={`${styles.siblings} ${styles.wide}`}>
              <span>More in {featured.category}:</span>
              {siblings.map((s) => (
                <span key={s.id}>
                  {s.shortTitle}{" "}
                  <b>
                    {s.status === "resolved"
                      ? `Resolved ${s.resolution.outcome ?? ""}`.trim()
                      : `${s.yesPrice}¢`}
                  </b>
                </span>
              ))}
            </span>
          </div>
          <div className={styles.featuredAside}>
            {featured.series.length > 1 && (
              <Spark
                data={featured.series}
                change={featured.change}
                viewBox={[280, 56]}
                strokeWidth={2}
                className={styles.featuredSpark}
              />
            )}
            {facePile.length > 0 && (
              <span className={styles.facePile}>
                <span>
                  {facePile.map((t) => (
                    <Avatar key={t.id} trader={t} size={22} />
                  ))}
                </span>
                {facePile[0].name}
                {others > 0 &&
                  ` & ${others} ${followedHolders.length > 1 ? "you follow" : "others"}`}{" "}
                trade this
              </span>
            )}
          </div>
        </article>

        <div className={styles.cats} data-indicator="pill" role="group" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              aria-pressed={c === "All"}
              onClick={() => c !== "All" && onCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={styles.toolbar}>
          <b className={styles.wide}>Trending markets</b>
          <b className={styles.narrow}>Trending</b>
          <span className={styles.flex} />
          <div
            className={`seg ${styles.wide} ${styles.sortSeg}`} data-indicator="pill"
            role="group"
            aria-label="Sort"
          >
            {SORTS.map((s) => (
              <button
                key={s}
                className="seg-opt"
                aria-pressed={filters.sort === s}
                onClick={() => onFilters({ sort: s })}
              >
                {s}
              </button>
            ))}
          </div>
          {/* A narrower list folds the four sorts into a menu. (Wrapped: the
              menu's own display would otherwise outrank `wide` on a phone.) */}
          <span className={`${styles.wide} ${styles.sortMenu}`}>
          <Menu
            label={`Sort: ${filters.sort}`}
            triggerClassName="btn btn-secondary"
            trigger={
              <>
                <ArrowsDownUp size={14} />
                Sort: {filters.sort}
              </>
            }
          >
            {SORTS.map((s) => (
              <MenuItem
                key={s}
                checked={filters.sort === s}
                onSelect={() => onFilters({ sort: s })}
              >
                {s}
              </MenuItem>
            ))}
          </Menu>
          </span>
          <span className={styles.wide}>
          <Menu
            label={`Venue: ${venueFilterLabel(filters.venue)}`}
            triggerClassName="btn btn-secondary"
            trigger={
              <>
                <Bank size={14} />
                Venue: {venueFilterLabel(filters.venue)}
              </>
            }
          >
            {VENUES.map((v) => (
              <MenuItem
                key={v}
                checked={filters.venue === v}
                onSelect={() => onFilters({ venue: v })}
              >
                {v === "All" ? "All venues" : venueName(v)}
              </MenuItem>
            ))}
          </Menu>
          </span>
          <span className={styles.wide}>
            <FiltersPopover
              filters={filters}
              count={filterCount(filters)}
              onChange={onFilters}
            />
          </span>
          <button className={styles.filtersLink} onClick={() => onSheet(true)}>
            <FunnelSimple size={14} />
            Filters
          </button>
        </div>

        {preview === "error" && (
          <ResultsError
            title="Some markets didn’t load"
            detail={outageDetail("prices")}
            onRetry={onRetry}
          />
        )}
        <div className={styles.table}>
          <MarketTableHead />
          {preview === "loading" ? (
            <MarketListSkeleton rows={9} />
          ) : (
            rows.map((m, i) => (
              <MarketRow
                key={m.id}
                market={m}
                rank={i + 1}
                watched={state.watchlist.includes(m.id)}
                onWatch={() => services.toggleWatchlist(m.id)}
              />
            ))
          )}
          {preview !== "loading" && !matching.length && (
            <Empty
              icon={FunnelSimple}
              title="No markets match"
              description={`Nothing on ${venueList("or")} fits these filters. Loosen them to see more.`}
              action={
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    onFilters({
                      venue: "All",
                      status: "open",
                      min: null,
                      max: null,
                    });
                    // Also leaves the empty-state preview.
                    onRetry();
                  }}
                >
                  Reset filters
                </button>
              }
            />
          )}
          {preview !== "loading" && rows.length < matching.length && (
            <div className={styles.more}>
              <span>
                Showing {rows.length} of {matching.length}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={onShowAll}>
                Show all
              </button>
            </div>
          )}
        </div>
      </div>

      <aside
        className={styles.aside}
        aria-label="Your lists and people"
        data-panel-body
      >
        <div className={styles.asideHead}>
          <BookmarkSimple size={15} />
          <b>{list?.name ?? "Saved markets"}</b>
          <span className={styles.flex} />
          <Link href="/watchlist">All lists</Link>
        </div>
        {watchMarkets.map((m) => (
          <Link href={`/market/${m.id}`} className={styles.watchRow} key={m.id}>
            <b>{m.shortTitle}</b>
            <b>
              <Flash value={m.yesPrice}>{m.yesPrice}¢</Flash>
            </b>
            <span>{statusLine(m)}</span>
            <span
              className={
                m.status === "open" ? changeTone(m.change) : styles.muted
              }
            >
              {m.status === "open" ? changeText(m.change) : "—"}
            </span>
          </Link>
        ))}
        {!watchMarkets.length && (
          <p className={styles.asideNote}>
            {state.signedIn ? "Bookmark a market and it shows up here." : "Log in to keep a watchlist."}
          </p>
        )}
        <div className={`${styles.asideHead} ${styles.asideGap}`}>
          <Trophy size={15} />
          <b>Top traders · 30d</b>
          <span className={styles.flex} />
          <Link href="/leaderboard">Leaderboard</Link>
        </div>
        {topTraders.map((t) => {
          const stat = t.stats["30D"];
          return (
            <Link
              href={`/trader/${t.id}`}
              className={styles.personRow}
              key={t.id}
            >
              <Avatar trader={t} size={28} />
              <span>
                <b>{t.name}</b>
                <span
                  className={styles.meta}
                  title={meta(t.focus, `${accuracy(stat)}% acc.`, `${stat.resolved} resolved`)}
                >
                  {t.focus && <span className={styles.metaFocus}>{t.focus}</span>}
                  <span>
                    {t.focus && <>&nbsp;· </>}
                    {stat.resolved >= MIN_SAMPLE
                      ? `${accuracy(stat)}% acc.`
                      : "low sample"}{" "}
                    · {stat.resolved} resolved
                  </span>
                </span>
              </span>
              <b className={tone(stat.pnlCents)}>
                {signedUsd(stat.pnlCents)}
              </b>
            </Link>
          );
        })}
        {!topTraders.length && <p className={styles.asideNote}>Rankings start once people trade.</p>}
        <div className={`${styles.asideHead} ${styles.asideGap}`}>
          <UsersThree size={15} />
          <b>Rooms active now</b>
        </div>
        {activeRooms.map((r) => (
          <Link href={`/rooms/${r.id}`} className={styles.roomRow} key={r.id}>
            <b>{r.name}</b>
            <span>{r.online} online</span>
          </Link>
        ))}
        {!activeRooms.length && <p className={styles.asideNote}>No rooms are active right now.</p>}
      </aside>

      <FiltersSheet
        open={sheet}
        onOpenChange={onSheet}
        filters={filters}
        markets={reachable}
        onApply={onFilters}
      />
    </div>
  );
}
