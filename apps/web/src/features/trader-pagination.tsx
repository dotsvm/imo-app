"use client";

import styles from "./trader-pagination.module.css";

const PAGE_SIZE = 20;

export function TraderPagination({
  shown,
  total,
  onLoadMore,
}: {
  shown: number;
  total: number;
  onLoadMore: () => void;
}) {
  if (total === 0) return null;
  const remaining = total - shown;
  return (
    <div className={styles.footer}>
      {remaining > 0 && (
        <button className={styles.loadMore} onClick={onLoadMore}>
          Load {Math.min(PAGE_SIZE, remaining)} more
        </button>
      )}
      <p role="status" className={remaining > 0 ? "sr-only" : styles.complete}>
        {remaining > 0
          ? `Showing ${shown} of ${total} traders`
          : `All ${total} traders shown`}
      </p>
    </div>
  );
}
