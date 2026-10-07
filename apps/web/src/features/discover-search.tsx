"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Market, Room, Trader } from "@imo/domain/types";
import { venueList, venueName } from "@/data/venues";
import { answersInPreview, outageDetail } from "@/data/previews";
import { useDemo } from "@/services/provider";
import { compactUsd } from "@imo/domain/money";
import { Avatar, FollowButton, meta } from "@/components/ui";
import {
  CircleX,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  PaperPlaneTilt,
  X,
} from "@/components/icons";
import { changeText, changeTone, Spark } from "@/components/market-bits";
import {
  closest,
  search,
  SEARCH_FIELD,
  SEARCH_TABS,
  statusLine,
  type SearchTab,
} from "./discover-model";
import { MarketListSkeleton, ResultsError } from "./discover-parts";
import { Bone } from "@/components/skeleton";
import styles from "./discover-search.module.css";

/** Words that name nothing on their own: question words, dates, verbs. */
const PLAIN = new Set(
  (
    "will the a an by in on of for to and or than more less above below over under before after " +
    "reach win yes no who what which how when is be at with end hit price between up down new first " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday"
  ).split(" "),
);

/** Search ideas from what's trending: the names its questions mention most. */
export function suggestionsFrom(markets: Market[], count = 6) {
  const seen = new Map<string, number>();
  for (const m of markets)
    for (const word of new Set(m.title.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) ?? []))
      if (!PLAIN.has(word.toLowerCase())) seen.set(word, (seen.get(word) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, count).map(([word]) => word);
}

function MarketResult({ market }: { market: Market }) {
  return (
    <Link
      href={`/market/${market.id}`}
      className={styles.marketRow}
      data-market={market.id}
    >
      <span className={styles.marketText}>
        <b>{market.title}</b>
        <span>
          <span className={styles.wide}>{market.category} · </span>
          <span className="venue">{venueName(market.venueId)}</span> ·{" "}
          {statusLine(market)}
        </span>
      </span>
      <Spark
        data={market.series}
        change={market.change}
        className={styles.spark}
      />
      <b className={styles.price}>{market.yesPrice}¢</b>
      <span className={`${styles.num} ${changeTone(market.change)}`}>
        {market.status === "open" ? changeText(market.change) : "—"}
      </span>
      <span className={styles.num}>{compactUsd(market.volumeCents)}</span>
    </Link>
  );
}

function TraderResult({ trader }: { trader: Trader }) {
  return (
    <div className={styles.personRow}>
      <Avatar trader={trader} size={36} />
      <Link href={`/trader/${trader.id}`} className={styles.personText}>
        <b>{trader.name}</b>
        <span>
          <span className={styles.wide}>
            {meta(`@${trader.handle}`, trader.focus, `${trader.followers.toLocaleString()} followers`)}
          </span>
          <span className={styles.narrow}>{trader.focus}</span>
        </span>
      </Link>
      <FollowButton trader={trader} compact />
    </div>
  );
}

function RoomResult({ room }: { room: Room }) {
  const { services } = useDemo();
  const joined = room.members.includes("you");
  const invite = room.privacy === "Invite only";
  return (
    <div className={styles.personRow}>
      <span className={styles.roomMark} aria-hidden="true">
        {room.symbol}
      </span>
      <Link href={`/rooms/${room.id}`} className={styles.personText}>
        <b>{room.name}</b>
        <span>
          {room.memberCount.toLocaleString()} members · {room.watchlist.length}{" "}
          markets
        </span>
      </Link>
      <button
        className="btn btn-secondary btn-sm"
        aria-pressed={joined}
        onClick={() => services.social.joinRoom(room.id)}
      >
        {joined ? "Joined" : invite ? "Request" : "Join"}
      </button>
    </div>
  );
}

/** Results on their way: the markets list, and people and rooms beside it. */
function ResultsLoading() {
  return (
    <div className={styles.grid}>
      <div className={styles.left}>
        <section className={styles.section}>
          <div className={styles.label} data-lead>
            Markets
          </div>
          <MarketListSkeleton />
        </section>
      </div>
      <div className={styles.right} aria-hidden="true">
        {(["Traders", "Rooms"] as const).map((label) => (
          <section key={label} className={styles.section}>
            <div className={styles.label}>{label}</div>
            {[96, 118].map((w) => (
              <div key={w} className={styles.personRow}>
                <Bone w={36} h={36} r={label === "Rooms" ? 10 : "pill"} />
                <span className={styles.personText} style={{ gap: 6 }}>
                  <Bone w={w} h={12} />
                  <Bone w={w + 40} h={9} />
                </span>
                <Bone w={58} h={28} r="pill" />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** 03.4 · nothing at all: say so, offer the nearest things, and a way out. */
function NoResults({ query }: { query: string }) {
  const { services, state } = useDemo();
  const [asked, setAsked] = useState(false);
  const near = closest(query, services.markets.list(), state.rooms);
  return (
    <div className={styles.none}>
      <MagnifyingGlassMinus size={28} />
      <h2>No results for “{query}”</h2>
      <p>
        No markets, traders or rooms match. Try fewer words, or check the
        spelling.
      </p>
      {(near.market || near.room) && (
        <div className={styles.closest}>
          <span className={styles.label}>Closest matches</span>
          {near.market && (
            <Link href={`/market/${near.market.id}`}>
              <span>{near.market.shortTitle}</span>
              <b>{near.market.yesPrice}¢</b>
            </Link>
          )}
          {near.room && (
            <Link href={`/rooms/${near.room.id}`}>
              <span>Room · {near.room.name}</span>
              <span>{near.room.memberCount.toLocaleString()} members</span>
            </Link>
          )}
        </div>
      )}
      <button
        className={`btn btn-secondary ${styles.suggest}`}
        disabled={asked}
        onClick={() => setAsked(true)}
      >
        <PaperPlaneTilt size={15} />
        {asked ? "Suggestion sent" : "Suggest this market"}
      </button>
      {asked && (
        <p className={styles.thanks} role="status">
          Thanks — imo lists markets from {venueList("and")}, and will look
          for one on “{query}”.
        </p>
      )}
    </div>
  );
}

/** 03.5 · one tab is empty while others have results. */
function TabEmpty({
  tab,
  query,
  onClear,
}: {
  tab: Exclude<SearchTab, "All">;
  query: string;
  onClear: () => void;
}) {
  const copy = {
    Markets: {
      title: `No markets match “${query}”`,
      body: "Try fewer words, or browse every open market in Discover.",
      href: "/discover",
      action: "Browse Discover",
    },
    Traders: {
      title: `No traders match “${query}”`,
      body: "Handles are exact. Search by name, or browse the leaderboard for macro traders.",
      href: "/leaderboard",
      action: "Open leaderboard",
    },
    Rooms: {
      title: `No rooms match “${query}”`,
      body: "Rooms are named for what their members trade. Browse them all instead.",
      href: "/rooms",
      action: "Browse rooms",
    },
  }[tab];
  return (
    <div className={styles.tabEmpty}>
      <MagnifyingGlassMinus size={24} />
      <b>{copy.title}</b>
      <span>{copy.body}</span>
      <span className={styles.actions}>
        <Link href={copy.href} className="btn btn-secondary">
          {copy.action}
        </Link>
        <button className="btn btn-ghost" onClick={onClear}>
          Clear search
        </button>
      </span>
    </div>
  );
}

/**
 * 03.1 / 03.2 · search takes over the top of the screen: the query field,
 * then All · Markets · Traders · Rooms, ranked by relevance.
 */
export function DiscoverSearch({
  query,
  tab,
  preview,
  onQuery,
  onTab,
  onExit,
  onRetry,
}: {
  query: string;
  tab: SearchTab;
  preview: "loading" | "error" | "empty" | null;
  onQuery: (q: string) => void;
  onTab: (tab: SearchTab) => void;
  onExit: () => void;
  onRetry: () => void;
}) {
  const { services, state, ready } = useDemo();
  const input = useRef<HTMLInputElement>(null);
  const tablist = useRef<HTMLDivElement>(null);
  const id = useId();
  const [text, setText] = useState(query);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const change = (value: string) => {
    setText(value);
    onQuery(value);
  };
  // The server finds matches anywhere; what's loaded answers instantly.
  // Both go through the same ranking.
  const found = services.markets.search(text);
  const union = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()];
  // In the error preview one venue is "down"; the rest still answer.
  const markets = union(found?.markets ?? [], services.markets.list()).filter((m) =>
    answersInPreview(preview, m.venueId),
  );
  const results = search(
    text,
    markets,
    union(found?.traders ?? [], services.profiles.list()).filter((t) => t.id !== "you"),
    union(found?.rooms ?? [], state.rooms),
  );
  // Nothing here yet and the server hasn't answered: results are coming,
  // not missing.
  const waiting = !ready || preview === "loading" || (!results.total && !!text.trim() && found === undefined);
  const counts: Record<SearchTab, number> = {
    All: results.total,
    Markets: results.markets.length,
    Traders: results.traders.length,
    Rooms: results.rooms.length,
  };
  const trending = markets.filter((m) => m.status === "open").slice(0, 6);
  const suggestions = suggestionsFrom(markets.filter((m) => m.status === "open").slice(0, 60));
  const clear = () => {
    change("");
    input.current?.focus();
  };
  // With nothing to switch between, 03.4 drops the tab row entirely.
  const showTabs = Boolean(text.trim()) && (results.total > 0 || !!preview);
  // Arrow keys move between tabs and select them, as a tab row should.
  const onTabKey = (event: React.KeyboardEvent) => {
    const at = SEARCH_TABS.indexOf(tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % SEARCH_TABS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + SEARCH_TABS.length) % SEARCH_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? SEARCH_TABS.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    onTab(SEARCH_TABS[to]);
    tablist.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [to]?.focus();
  };

  const markSection = (
    <section className={styles.section} aria-label="Markets">
      {/* 03.2: on a phone, All opens straight onto the market rows. */}
      <div className={styles.label} data-lead={tab === "All" || undefined}>
        Markets
      </div>
      {results.markets.map((m) => (
        <MarketResult key={m.id} market={m} />
      ))}
      {!results.markets.length && (
        <p className={styles.noneHere}>No markets match.</p>
      )}
    </section>
  );
  const traderSection = (
    <section className={styles.section} aria-label="Traders">
      <div className={styles.label}>Traders</div>
      {results.traders.map((t) => (
        <TraderResult key={t.id} trader={t} />
      ))}
      {!results.traders.length && (
        <p className={styles.noneHere}>No traders match.</p>
      )}
    </section>
  );
  const roomSection = (
    <section className={styles.section} aria-label="Rooms">
      <div className={styles.label}>Rooms</div>
      {results.rooms.map((r) => (
        <RoomResult key={r.id} room={r} />
      ))}
      {!results.rooms.length && (
        <p className={styles.noneHere}>No rooms match.</p>
      )}
    </section>
  );

  return (
    <div className={styles.search}>
      <h1 className="sr-only">
        {text.trim() ? `Search results for “${text.trim()}”` : "Search"}
      </h1>
      <div className={styles.bar} data-alone={!showTabs || undefined}>
        <label className={styles.field}>
          <MagnifyingGlass size={16} />
          <input
            ref={input}
            id={SEARCH_FIELD}
            type="search"
            aria-label="Search markets, traders and rooms"
            placeholder="Search markets, traders, rooms"
            value={text}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onExit();
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {text && (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear search"
              onClick={clear}
            >
              <X size={15} className={styles.wideIcon} />
              <CircleX size={18} className={styles.narrowIcon} />
            </button>
          )}
        </label>
        <span className={styles.esc}>Esc to close</span>
        <button className={`btn btn-ghost ${styles.cancel}`} onClick={onExit}>
          Cancel
        </button>
      </div>

      {!text.trim() ? (
        <div className={styles.start}>
          {suggestions.length > 0 && (
            <>
              <div className={styles.label}>Try</div>
              <div className={styles.suggestions}>
                {suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => change(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className={styles.label}>Trending markets</div>
          {trending.map((m) => (
            <MarketResult key={m.id} market={m} />
          ))}
        </div>
      ) : (
        <>
          {showTabs && (
            <div
              ref={tablist}
              className={styles.tabs} data-indicator="line"
              role="tablist"
              aria-label="Result type"
              onKeyDown={onTabKey}
            >
              {SEARCH_TABS.map((name) => (
                <button
                  key={name}
                  id={`${id}-tab-${name}`}
                  role="tab"
                  aria-selected={tab === name}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => onTab(name)}
                >
                  {name}
                  {name === "All" ? (
                    <span className={styles.wide}> · {counts[name]}</span>
                  ) : (
                    <span>
                      <span className={styles.wide}> ·</span> {counts[name]}
                    </span>
                  )}
                </button>
              ))}
              <span className={styles.flex} />
              <span className={styles.sorted}>Sorted by relevance</span>
            </div>
          )}
          <div
            className={styles.panel}
            {...(showTabs && {
              role: "tabpanel",
              id: `${id}-panel`,
              "aria-labelledby": `${id}-tab-${tab}`,
            })}
          >
            {preview === "error" && (
              <ResultsError
                title="Search is temporarily unavailable"
                detail={outageDetail("results")}
                onRetry={onRetry}
              />
            )}
            {waiting ? (
              <ResultsLoading />
            ) : results.total === 0 ? (
              <NoResults query={text.trim()} />
            ) : tab !== "All" && counts[tab] === 0 ? (
              <TabEmpty tab={tab} query={text.trim()} onClear={clear} />
            ) : tab === "All" ? (
              <div className={styles.grid}>
                <div className={styles.left}>{markSection}</div>
                <div className={styles.right}>
                  {traderSection}
                  {roomSection}
                </div>
              </div>
            ) : (
              <div className={styles.single}>
                {tab === "Markets"
                  ? markSection
                  : tab === "Traders"
                    ? traderSection
                    : roomSection}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
