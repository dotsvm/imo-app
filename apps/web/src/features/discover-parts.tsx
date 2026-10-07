"use client";
/* Pieces the Discover screens share: the market table row (02.1), the
   category card (03.3), the list skeleton (03.6) and the results error
   (03.7). */
import Link from "next/link";
import { complement } from "@imo/core/market";
import type { Market } from "@imo/domain/types";
import { compactUsd } from "@imo/domain/money";
import { ArrowClockwise, BookmarkSimple, Warning } from "@/components/icons";
import {
  changeText,
  changeTone,
  Spark,
  VenueBadge,
} from "@/components/market-bits";
import { closesIn, statusLine } from "./discover-model";
import styles from "./discover.module.css";
import { venueName } from "@/data/venues";
import { Flash } from "@/components/motion";

/** 02.1 table row: rank, market, 7d, Yes, No, 24h, volume, closes, watch. */
export function MarketRow({
  market,
  rank,
  watched,
  onWatch,
}: {
  market: Market;
  rank: number;
  watched: boolean;
  onWatch: () => void;
}) {
  // A settled contract has no live price: the digits stay, the emphasis goes.
  const settled = market.status !== "open";
  return (
    <div
      className={styles.row}
      data-market={market.id}
      data-settled={settled || undefined}
    >
      <span className={styles.rank}>{String(rank).padStart(2, "0")}</span>
      <span className={styles.rowTitle}>
        <Link href={`/market/${market.id}`} className={styles.rowLink}>
          {market.title}
        </Link>
        <span className={styles.rowMeta}>
          {market.category} ·{" "}
          <span className="venue">{venueName(market.venueId)}</span>
          {/* People on imo holding either side, once anyone does. */}
          {market.holders.yes + market.holders.no > 0 && (
            <span className={styles.wide}>
              {" "}· {(market.holders.yes + market.holders.no).toLocaleString()} on imo
            </span>
          )}
          <span className={styles.narrow}> · {compactUsd(market.volumeCents)}</span>
        </span>
      </span>
      <Spark
        data={market.series}
        change={market.change}
        className={styles.rowSpark}
      />
      <b className={styles.yes}>
        <Flash value={market.yesPrice}>{market.yesPrice}¢</Flash>
      </b>
      <span className={styles.no} data-col="no">
        <Flash value={complement(market.yesPrice)}>{complement(market.yesPrice)}¢</Flash>
      </span>
      <span
        className={`${styles.num} ${settled ? styles.muted : changeTone(market.change)}`}
        data-col="chg"
      >
        {settled ? "—" : changeText(market.change)}
      </span>
      <span className={styles.num} data-col="vol">
        {compactUsd(market.volumeCents)}
      </span>
      <span className={`${styles.num} ${styles.muted}`} data-col="closes">
        {closesIn(market)}
      </span>
      <button
        className={`${styles.watch} pop`}
        aria-pressed={watched}
        aria-label={`${watched ? "Remove" : "Add"} ${market.shortTitle} ${watched ? "from" : "to"} watchlist`}
        onClick={onWatch}
      >
        <BookmarkSimple size={15} />
      </button>
    </div>
  );
}

/** 02.1 column labels, sharing the row's grid. */
export function MarketTableHead() {
  return (
    <div className={styles.tableHead} aria-hidden="true">
      <span>#</span>
      <span>Market</span>
      <span data-col="spark">7d</span>
      <span className={styles.num}>Yes</span>
      <span className={styles.num} data-col="no">
        No
      </span>
      <span className={styles.num}>24h</span>
      <span className={styles.num} data-col="vol">
        Volume
      </span>
      <span className={styles.num} data-col="closes">
        Closes
      </span>
      <span />
    </div>
  );
}

/** Yes / No pills that open the market with that side chosen. */
export function OutcomeLinks({
  market,
  size = "md",
}: {
  market: Market;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={styles.outcomes} data-size={size}>
      {(["Yes", "No"] as const).map((o) => (
        <Link
          key={o}
          href={`/market/${market.id}?outcome=${o}`}
          className={o === "Yes" ? "side side-yes" : "side side-no"}
          aria-label={`${o} on ${market.shortTitle} at ${o === "Yes" ? market.yesPrice : complement(market.yesPrice)}¢`}
        >
          {o} {o === "Yes" ? market.yesPrice : complement(market.yesPrice)}¢
        </Link>
      ))}
    </span>
  );
}

/** 03.3 card: venue and status, the question, the price with its line,
    then either the two sides or where the contract stands. */
export function MarketCard({ market }: { market: Market }) {
  const open = market.status === "open";
  return (
    <article className={styles.card} data-market={market.id}>
      <span className={styles.cardMeta}>
        <VenueBadge venueId={market.venueId} />
        <span className="venue">{venueName(market.venueId)}</span>
        <span className={styles.statusDot} data-open={open || undefined} />
        <span>
          {open ? "Open" : market.status === "resolved" ? "Resolved" : "Closed"}
        </span>
        <span className={styles.flex} />
        <span>{compactUsd(market.volumeCents)} vol</span>
      </span>
      <Link href={`/market/${market.id}`} className={styles.cardTitle}>
        {market.title}
      </Link>
      <span className={styles.cardPrice}>
        <span>
          <b>{market.yesPrice}¢</b>
          <span className={open ? changeTone(market.change) : styles.muted}>
            {open ? `${changeText(market.change)} today` : "settled"}
          </span>
        </span>
        <Spark
          data={market.series}
          change={open ? market.change : 0}
          viewBox={[280, 56]}
          className={styles.cardSpark}
        />
      </span>
      {open ? (
        <OutcomeLinks market={market} />
      ) : (
        <span className={styles.cardStatus}>{statusLine(market)}</span>
      )}
    </article>
  );
}

/** 03.6: skeleton rows mirror the list; no spinners. */
export function MarketListSkeleton({ rows = 5 }: { rows?: number }) {
  const widths = ["72%", "58%", "80%", "64%", "50%"];
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading markets" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden="true">
          <span>
            <span style={{ width: widths[i % widths.length] }} />
            <span />
          </span>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

/** 03.7: what failed, and what is still shown. */
export function ResultsError({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.error} role="alert">
      <Warning size={20} />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
        <button className="btn btn-secondary" onClick={onRetry}>
          <ArrowClockwise size={15} />
          Retry
        </button>
      </div>
    </div>
  );
}
