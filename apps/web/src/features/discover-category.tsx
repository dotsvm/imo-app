"use client";
import Link from "next/link";
import type { Category, Market } from "@imo/domain/types";
import { answersInPreview, outageDetail } from "@/data/previews";
import { useDemo } from "@/services/provider";
import { compactUsd } from "@imo/domain/money";
import { CaretDown, Rows, SquaresFour } from "@/components/icons";
import { Empty } from "@/components/ui";
import {
  daysLeft,
  order,
  serverFilters,
  SORTS,
  SUBSETS,
  type Filters,
  type Sort,
} from "./discover-model";
import {
  MarketCard,
  MarketListSkeleton,
  MarketRow,
  MarketTableHead,
  ResultsError,
} from "./discover-parts";
import styles from "./discover-category.module.css";

/** 03.3 · a category: its title, sub-topics, sort, and markets as cards. */
export function DiscoverCategory({
  category,
  filters,
  preview,
  onParam,
}: {
  category: Category;
  filters: Filters;
  preview: "loading" | "error" | "empty" | null;
  onParam: (patch: Record<string, string | null>) => void;
}) {
  const { services, state } = useDemo();
  const all = services.markets.list();
  // Every market in the category, from the server (the loaded ones meanwhile).
  const fromServer = services.markets.query(
    serverFilters({ ...filters, status: "all", min: null, max: null }, category),
  );
  const inCategory = (fromServer ?? all).filter(
    (m) =>
      m.category === category &&
      (filters.venue === "All" || m.venueId === filters.venue) &&
      answersInPreview(preview, m.venueId),
  );
  const open = inCategory.filter((m) => m.status === "open");
  const volume = inCategory.reduce((n, m) => n + m.volumeCents, 0);
  const soon = open.filter((m) => daysLeft(m.closesAt) <= 7).length;
  const next = Math.min(...open.map((m) => daysLeft(m.closesAt)));
  const groups = SUBSETS[category];
  const subsets = ["All", ...Object.keys(groups ?? {})];
  const subset = subsets.includes(filters.subset) ? filters.subset : "All";
  const keywords = groups?.[subset];
  const shown: Market[] =
    preview === "empty"
      ? []
      : order(
          keywords
            ? inCategory.filter((m) =>
                keywords.some((k) => m.title.toLowerCase().includes(k)),
              )
            : inCategory,
          filters.sort,
          all,
        )
          // Open contracts lead; settled ones follow in the same order.
          .toSorted(
            (a, b) => Number(b.status === "open") - Number(a.status === "open"),
          );

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.crumb}>
          <Link href="/discover">Discover</Link> / {category}
        </span>
        <h1 className={styles.title}>{category}</h1>
        <span className={styles.stats}>
          {/* The page lists up to 100; past that, the counts are floors. */}
          {open.length}
          {inCategory.length >= 100 ? "+" : ""} open · {compactUsd(volume)}
          {inCategory.length >= 100 ? "+" : ""} volume
          {soon
            ? ` · ${soon} resolving in 7 days`
            : open.length
              ? ` · next closes in ${next}d`
              : ""}
        </span>
      </header>

      <div className={styles.controls}>
        <div className={styles.subsets} role="group" aria-label="Topics">
          {subsets.map((s) => (
            <button
              key={s}
              aria-pressed={subset === s}
              onClick={() => onParam({ subset: s === "All" ? null : s })}
            >
              {s}
            </button>
          ))}
        </div>
        <span className={styles.flex} />
        <label className={styles.sort}>
          <span aria-hidden="true">
            Sort: {filters.sort}
            <CaretDown size={11} />
          </span>
          <select
            aria-label="Sort markets"
            value={filters.sort}
            onChange={(e) => onParam({ sort: e.target.value as Sort })}
          >
            {SORTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <span className={styles.views} role="group" aria-label="Layout">
          <button
            aria-label="Grid"
            title="Grid"
            aria-pressed={filters.view === "grid"}
            onClick={() => onParam({ view: null })}
          >
            <SquaresFour size={14} />
          </button>
          <button
            aria-label="List"
            title="List"
            aria-pressed={filters.view === "list"}
            onClick={() => onParam({ view: "list" })}
          >
            <Rows size={14} />
          </button>
        </span>
      </div>

      {preview === "error" && (
        <ResultsError
          title="Some markets didn’t load"
          detail={outageDetail("markets")}
          onRetry={() => onParam({ state: null })}
        />
      )}
      {preview === "loading" ? (
        <MarketListSkeleton rows={6} />
      ) : !shown.length ? (
        <Empty
          title={`No ${category} markets here`}
          description="Nothing matches this topic and venue. Try all topics, or browse every category."
          action={
            <>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  onParam({ subset: null, venue: null, state: null })
                }
              >
                Show all {category}
              </button>
              <Link href="/discover" className="btn btn-ghost">
                Back to Discover
              </Link>
            </>
          }
        />
      ) : filters.view === "grid" ? (
        <div className={styles.cards}>
          {shown.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      ) : (
        <div className={styles.list}>
          <MarketTableHead />
          {shown.map((m, i) => (
            <MarketRow
              key={m.id}
              market={m}
              rank={i + 1}
              watched={state.watchlist.includes(m.id)}
              onWatch={() => services.toggleWatchlist(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
