import type { CSSProperties } from "react";
import layout from "./discover.module.css";
import { MarketListSkeleton } from "./discover-parts";
import styles from "./discover-loading.module.css";

const CATEGORIES = [40, 86, 64, 44, 60, 58, 54, 52, 58];
const ASIDE = ["saved", "traders", "rooms"] as const;

const Bar = ({ w, h }: { w: number | string; h?: number }) => (
  <span className={styles.bar} style={{ width: w, ...(h ? { height: h } : {}) } as CSSProperties} />
);
const Pill = ({ w }: { w: number }) => <span className={styles.pill} style={{ width: w }} />;

/**
 * 02.1 while the markets load: the featured event, the category chips, the
 * trending table and the side column, in the page's own layout — so nothing
 * moves when the real content arrives.
 */
export function DiscoverLoading() {
  return (
    <div className={layout.discover} role="status" aria-label="Loading markets" aria-busy="true">
      <span className="sr-only">Loading the featured event, categories and trending markets…</span>
      <div className={layout.main} aria-hidden="true">
        <div className={layout.featured}>
          <div className={layout.featuredBody}>
            <Bar w={132} />
            <Bar w="78%" h={24} />
            <Bar w="52%" h={24} />
            <span className={styles.row}>
              <Pill w={104} />
              <Pill w={104} />
              <Bar w={150} />
            </span>
            <Bar w="58%" />
          </div>
          <div className={`${layout.featuredAside} ${layout.wide}`}>
            <span className={styles.spark} />
          </div>
        </div>
        <div className={layout.cats}>
          {CATEGORIES.map((w, i) => (
            <Pill key={i} w={w} />
          ))}
        </div>
        <div className={layout.toolbar}>
          <Bar w={120} />
          <span className={layout.flex} />
          <span className={layout.wide}>
            <Pill w={250} />
          </span>
          <Pill w={96} />
        </div>
        <div className={`${layout.tableHead} ${layout.wide}`}>
          <Bar w="100%" h={8} />
        </div>
        <MarketListSkeleton rows={9} />
      </div>
      <div className={layout.aside} aria-hidden="true">
        {ASIDE.map((section) => (
          <div key={section} className={styles.section}>
            <div className={layout.asideHead}>
              <Bar w={130} />
            </div>
            {[0, 1, 2].map((i) => (
              <span key={i} className={styles.asideRow}>
                <span className={styles.avatar} />
                <span className={styles.stack}>
                  <Bar w={i % 2 ? "62%" : "74%"} />
                  <Bar w="40%" h={8} />
                </span>
                <Bar w={44} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
