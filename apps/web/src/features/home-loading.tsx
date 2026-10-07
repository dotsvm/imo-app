import styles from "./home-loading.module.css";

const TRADERS = [0, 1, 2, 3, 4, 5, 6];
const POSTS = ["90%", "75%", "85%"];
const MARKETS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** 06.4 · skeletons mirror the final layout; no spinners for lists. */
export function FeedSkeleton({ widths = POSTS }: { widths?: string[] }) {
  return (
    <>
      {widths.map((width, i) => (
        <div key={i} className={styles.post}>
          <span className={styles.avatar} />
          <span className={styles.stack}>
            <span className={styles.bar} style={{ width: "40%", height: 12 }} />
            <span className={styles.bar} style={{ width }} />
            <span className={styles.bar} style={{ width: "70%" }} />
            <span className={styles.card} />
          </span>
        </div>
      ))}
    </>
  );
}

export function HomeLoading() {
  return (
    <div
      className={styles.loading}
      role="status"
      aria-label="Loading your feed"
      aria-busy="true"
    >
      <span className="sr-only">
        Loading trader rankings, predictions, and trending markets…
      </span>
      <div className={styles.tabs} aria-hidden="true">
        {[52, 64, 52, 58].map((w, i) => (
          <span key={i} className={styles.bar} style={{ width: w }} />
        ))}
      </div>
      <div className={styles.columns} aria-hidden="true">
        <div className={styles.panel} data-panel="traders">
          <div className={styles.header}>
            <span className={styles.pill} style={{ width: 118 }} />
          </div>
          <div className={styles.filters}>
            <span className={styles.pill} style={{ width: 54 }} />
            <span className={styles.pill} style={{ width: 52 }} />
            <span className={styles.pill} style={{ width: 112 }} />
          </div>
          {TRADERS.map((n) => (
            <div key={n} className={styles.trader}>
              <span className={styles.bar} style={{ width: 10 }} />
              <span
                className={styles.avatar}
                style={{ width: 34, height: 34 }}
              />
              <span className={styles.stack} style={{ gap: 6 }}>
                <span
                  className={styles.bar}
                  style={{ width: `${62 - n * 3}%` }}
                />
                <span
                  className={styles.bar}
                  style={{ width: "86%", height: 8 }}
                />
              </span>
              <span
                className={styles.stack}
                style={{ gap: 6, alignItems: "flex-end" }}
              >
                <span className={styles.bar} style={{ width: 72 }} />
                <span className={styles.bar} style={{ width: 48, height: 8 }} />
              </span>
            </div>
          ))}
        </div>
        <div className={styles.panel} data-panel="feed">
          <div className={styles.header}>
            <span className={styles.pill} style={{ width: 164 }} />
            <span className={styles.flex} />
            <span className={styles.pill} style={{ width: 132 }} />
          </div>
          <FeedSkeleton />
        </div>
        <div className={styles.panel} data-panel="trending">
          <div className={styles.header}>
            <span className={styles.pill} style={{ width: 104 }} />
            <span className={styles.flex} />
            <span className={styles.pill} style={{ width: 48 }} />
          </div>
          {MARKETS.map((n) => (
            <div key={n} className={styles.market}>
              <span className={styles.tile} />
              <span className={styles.stack} style={{ gap: 6 }}>
                <span
                  className={styles.bar}
                  style={{ width: `${70 - (n % 3) * 12}%` }}
                />
                <span
                  className={styles.bar}
                  style={{ width: "42%", height: 8 }}
                />
              </span>
              <span className={styles.bar} style={{ width: 40, height: 14 }} />
              <span
                className={styles.stack}
                style={{ gap: 6, alignItems: "flex-end" }}
              >
                <span className={styles.bar} style={{ width: 30 }} />
                <span className={styles.bar} style={{ width: 24, height: 8 }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
