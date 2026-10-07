"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretDown, SlidersHorizontal, Trophy } from "@/components/icons";
import { useDemo, useLoadingView } from "@/services/provider";
import { Bone, Loading } from "@/components/skeleton";
import { signedUsd, usd, tone, signedPct } from "@imo/domain/money";
import { MIN_SAMPLE, accuracy } from "@imo/domain/engine";
import type { Category, Trader } from "@imo/domain/types";
import { Avatar, Button, FollowButton, Modal, relativeTime, meta } from "@/components/ui";
import { CATEGORIES } from "./discover-model";
import { Menu, MenuItem } from "@/components/menu";
import { useMediaQuery } from "@/components/use-media-query";
import styles from "./leaderboard.module.css";
import { TraderPagination } from "./trader-pagination";
import { useListPagination } from "./use-list-pagination";

const periods = ["7D", "30D", "90D", "All"] as const;
const sorts = ["P&L", "ROI", "Right"] as const;
const categories: (Category | "All categories")[] = [
  "All categories",
  ...CATEGORIES.filter((c): c is Category => c !== "All"),
];
type Period = (typeof periods)[number];
type Sort = (typeof sorts)[number];

/** The next wider window, for "Show 30D" when a narrow one is empty. */
const wider: Partial<Record<Period, Period>> = {
  "7D": "30D",
  "30D": "90D",
  "90D": "All",
};

/** Ten rows of the board while it loads, in the table's own columns. */
const LOADING_ROWS = [118, 96, 104, 88, 126, 92, 110, 100, 84, 120];

function PhoneRowsLoading() {
  return (
    <Loading label="Loading the leaderboard" className={styles.phoneList}>
      {LOADING_ROWS.map((w, i) => (
        <div key={i} className={styles.phoneRow}>
          <Bone w={16} h={12} />
          <Bone circle={38} />
          <span className={styles.phoneName}>
            <Bone w={w} h={12} />
            <Bone w={w + 22} h={9} />
          </span>
          <span className={styles.phoneFigures}>
            <Bone w={66} h={12} />
            <Bone w={38} h={9} />
          </span>
        </div>
      ))}
    </Loading>
  );
}

function TableRowsLoading() {
  return LOADING_ROWS.map((w, i) => (
    <tr key={i} aria-hidden="true">
      <td className={styles.rank}>
        <Bone w={16} h={12} />
      </td>
      <th scope="row">
        <span className={styles.trader}>
          <Bone circle={34} />
          <span style={{ gap: 7, padding: "3px 0" }}>
            <Bone w={w} h={12} />
            <Bone w={w + 40} h={9} />
          </span>
        </span>
      </th>
      {[78, 46, 30, 28, 52, 64].map((cell, c) => (
        <td key={c} className={styles.number}>
          <Bone w={cell} h={12} style={{ marginLeft: "auto" }} />
        </td>
      ))}
      <td className={styles.follow}>
        <Bone w={66} h={26} r="pill" />
      </td>
    </tr>
  ));
}

export function Leaderboard() {
  const phone = useMediaQuery("(max-width: 600px)");
  const { state, services } = useDemo();
  const loading = useLoadingView();
  const params = useSearchParams();
  const pathname = usePathname();
  const period = (periods.find((p) => p === params.get("period")) ??
    "30D") as Period;
  const sort = (sorts.find((s) => s === params.get("sort")) ?? "P&L") as Sort;
  const category = categories.includes(
    (params.get("category") ?? "") as Category,
  )
    ? (params.get("category") as Category)
    : "All categories";
  const minSample = params.get("sample") !== "off";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set(key, value);
    window.history.replaceState(null, "", `${pathname}?${next}`);
  };
  const metric = (t: Trader) =>
    sort === "ROI"
      ? t.stats[period].returnPct
      : sort === "Right"
        ? accuracy(t.stats[period])
        : t.stats[period].pnlCents;
  const eligible = services.profiles.list().filter(
    (t) =>
      // Opting out of public ranking hides the demo account from the board.
      (t.id !== "you" || state.settings.appearOnLeaderboard) &&
      (category === "All categories" || t.interests.includes(category)),
  );
  const board = eligible
    .filter((t) => !minSample || t.stats[period].resolved >= MIN_SAMPLE)
    .toSorted((a, b) => metric(b) - metric(a));

  const { visible: visibleTraders, loadMore } = useListPagination(
    board,
    `${category}:${period}:${sort}:${minSample}:${state.settings.appearOnLeaderboard}`,
  );

  const noResults = (
    <div className={styles.noResults}>
      <Trophy size={22} />
      <strong>
        No {category === "All categories" ? "" : `${category} `}traders with{" "}
        {MIN_SAMPLE}+ resolved in {period}
      </strong>
      <p>Widen the period or turn off the minimum-sample filter.</p>
      <div className={styles.noResultsActions}>
        {wider[period] && (
          <Button onClick={() => update("period", wider[period]!)}>
            Show {wider[period]}
          </Button>
        )}
        <Button variant="ghost" onClick={() => update("sample", "off")}>
          Show all {eligible.length} traders
        </Button>
      </div>
    </div>
  );

  // 14.2 · a phone: the board as a list, filters in a sheet.
  if (phone)
    return (
      <div className={styles.phone}>
        <header className={styles.phoneHead}>
          <h1>Top traders</h1>
          <button
            type="button"
            className={`btn btn-icon ${styles.phoneIcon}`}
            aria-label="Filters"
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal size={20} />
          </button>
        </header>
        <div className={styles.chips} role="group" aria-label="Period" data-indicator="pill">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => update("period", p)}
            >
              {p}
            </button>
          ))}
          <Menu
            label={`Rank by: ${sort}`}
            align="end"
            triggerClassName={styles.chipMenu}
            trigger={
              <>
                {sort}
                <CaretDown size={12} />
              </>
            }
          >
            {sorts.map((x) => (
              <MenuItem
                key={x}
                checked={sort === x}
                onSelect={() => update("sort", x)}
              >
                {x}
              </MenuItem>
            ))}
          </Menu>
        </div>
        {loading ? (
          <PhoneRowsLoading />
        ) : (
          <ol className={styles.phoneList} aria-label={`Ranked by ${sort}`}>
            {visibleTraders.map((trader, i) => {
              const stat = trader.stats[period];
              return (
                <li key={trader.id}>
                  <Link href={`/trader/${trader.id}`} className={styles.phoneRow}>
                    <b className={i < 3 ? styles.podium : styles.rank}>
                      {String(i + 1).padStart(2, "0")}
                    </b>
                    <Avatar trader={trader} size={38} />
                    <span className={styles.phoneName}>
                      <b>{trader.name}</b>
                      <span>
                        {accuracy(stat)}% right · {stat.resolved} resolved
                        {stat.resolved < MIN_SAMPLE ? " · low sample" : ""}
                      </span>
                    </span>
                    <span className={styles.phoneFigures}>
                      <b className={tone(stat.pnlCents)}>
                        {signedUsd(stat.pnlCents)}
                      </b>
                      <span
                        className={tone(stat.returnPct)}
                      >
                        {signedPct(stat.returnPct)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {!loading && (
          <TraderPagination
            shown={visibleTraders.length}
            total={board.length}
            onLoadMore={loadMore}
          />
        )}
        {!loading && !board.length && noResults}
        <Modal
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="Filters"
          description="Narrow the board by category and sample size."
        >
          <div className={styles.sheet}>
            <span className={styles.sheetLabel}>Category</span>
            <div
              className={styles.sheetChips}
              role="group"
              aria-label="Category"
            >
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => update("category", c)}
                >
                  {c === "All categories" ? "All" : c}
                </button>
              ))}
            </div>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={minSample}
                onChange={(e) =>
                  update("sample", e.target.checked ? "on" : "off")
                }
              />
              Only traders with {MIN_SAMPLE}+ resolved
            </label>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => setFiltersOpen(false)}
            >
              Show {board.length} {board.length === 1 ? "trader" : "traders"}
            </button>
          </div>
        </Modal>
      </div>
    );

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Leaderboard</h1>
          {loading ? (
            <Bone w={250} h={12} className={styles.subtitleBone} />
          ) : (
            <p>
              Ranked by {sort} · {period} · {board.length}{" "}
              {board.length === 1 ? "trader" : "traders"}
              {minSample ? ` · min. ${MIN_SAMPLE} resolved` : ""}
            </p>
          )}
        </div>
      </header>
      <div className={styles.controls}>
        <div className={styles.segment} data-indicator="pill" role="group" aria-label="Period">
          {periods.map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              onClick={() => update("period", p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className={styles.segment} data-indicator="pill" role="group" aria-label="Rank by">
          {sorts.map((s) => (
            <button
              key={s}
              aria-pressed={sort === s}
              onClick={() => update("sort", s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label className={styles.select}>
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(e) => update("category", e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <CaretDown size={12} aria-hidden="true" />
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={minSample}
            onChange={(e) => update("sample", e.target.checked ? "on" : "off")}
          />
          Min. {MIN_SAMPLE} resolved
        </label>
        <span className={styles.updated}>
          {state.leaderboardAt
            ? `Updated ${relativeTime(state.leaderboardAt)}${relativeTime(state.leaderboardAt) === "now" ? "" : " ago"}`
            : "Updated every 15 minutes"}
        </span>
      </div>
      {loading && (
        <p className="sr-only" role="status">
          Loading the leaderboard…
        </p>
      )}
      {(loading || board.length > 0) && (
        <div className={styles.tableWrap} aria-busy={loading || undefined}>
          <table className={styles.table}>
            <caption className="sr-only">
              Traders ranked by {sort} over {period}
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Trader</th>
                <th scope="col" className={styles.number}>
                  P&amp;L net
                </th>
                <th scope="col" className={styles.number}>
                  ROI
                </th>
                <th scope="col" className={styles.number}>
                  Right
                </th>
                <th scope="col" className={styles.number}>
                  Sample
                </th>
                <th scope="col" className={styles.number}>
                  Fees paid
                </th>
                <th scope="col" className={styles.number}>
                  Max drawdown
                </th>
                <th scope="col">
                  <span className="sr-only">Follow</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsLoading />
              ) : (
                  visibleTraders.map((trader, i) => {
                  const stat = trader.stats[period];
                  const low = stat.resolved < MIN_SAMPLE;
                  return (
                    <tr key={trader.id}>
                      <td className={i < 3 ? styles.podium : styles.rank}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <th scope="row">
                        <Link
                          className={styles.trader}
                          href={`/trader/${trader.id}`}
                        >
                          <Avatar trader={trader} size={34} />
                          <span>
                            <strong>{trader.name}</strong>
                            <span>
                              {meta(`@${trader.handle}`, trader.focus)}
                            </span>
                          </span>
                        </Link>
                      </th>
                      <td
                        className={`${styles.number} ${styles.strong} ${tone(stat.pnlCents)}`}
                      >
                        {signedUsd(stat.pnlCents)}
                      </td>
                      <td
                        className={`${styles.number} ${tone(stat.returnPct)}`}
                      >
                        {signedPct(stat.returnPct)}
                      </td>
                      <td className={`${styles.number} ${styles.strong}`}>
                        {accuracy(stat)}%
                      </td>
                      <td className={`${styles.number} ${styles.sample}`}>
                        <span>{stat.resolved}</span>
                        {low && (
                          <span className={styles.lowSample}>Low sample</span>
                        )}
                      </td>
                      <td className={styles.number}>
                        {usd(trader.record.feesCents)}
                      </td>
                      <td className={`${styles.number} negative`}>
                        {signedUsd(trader.record.maxDrawdownCents)}
                      </td>
                      <td className={styles.follow}>
                        <FollowButton trader={trader} compact />
                      </td>
                    </tr>
                  );
                  })
              )}
            </tbody>
          </table>
        </div>
      )}
      {!loading && (
        <TraderPagination
          shown={visibleTraders.length}
          total={board.length}
          onLoadMore={loadMore}
        />
      )}
      {!loading && !board.length && noResults}
      <p className={styles.footnote}>
        P&amp;L is realized + unrealized, after venue and app fees. Right is the
        share of resolved predictions that matched the outcome. Traders under{" "}
        {MIN_SAMPLE} resolved are hidden while the minimum-sample filter is on.
      </p>
    </div>
  );
}
