"use client";
import Link from "next/link";
import { complement } from "@imo/core/market";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Market, Outcome, Side } from "@imo/domain/types";
import { useDemo, useLive, useLoadingView, usePreviewState } from "@/services/provider";
import { compactUsd } from "@imo/domain/money";
import { CaretLeft, Flag, Lock } from "@/components/icons";
import { Empty } from "@/components/ui";
import { changeText } from "@/components/market-bits";
import { useMediaQuery } from "@/components/use-media-query";
import { daysLeft } from "./discover-model";
import { MarketChart } from "./market-chart";
import {
  BookError,
  Comment,
  Discussion,
  MarketLoading,
  OrderBook,
  PositionSummary,
  RecentTrades,
  Related,
  Rules,
  RulesDialog,
  ShareButton,
  TradeBar,
  discussionSize,
} from "./market-panels";
import { MarketState, TradeSheet, TradeTicket } from "./trade";
import { SaveToList } from "./save-to-list";
import { Composer } from "./social";
import styles from "./market.module.css";
import { venueName } from "@/data/venues";
import { Flash } from "@/components/motion";

const TABS = ["Overview", "Book", "Trades", "Rules", "Discussion"] as const;
type Tab = (typeof TABS)[number];

const date = (iso: string, year = false) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year && { year: "numeric" }),
    timeZone: "UTC",
  });

/** "Closes Dec 16, 2026 · 82d", or where a finished market stands. */
function closing(market: Market, short = false) {
  if (market.status === "closed")
    return `Closed ${date(market.closesAt)} · awaiting source`;
  if (market.status === "resolved") return `Resolved ${date(market.closesAt)}`;
  return `Closes ${date(market.closesAt, !short)} · ${daysLeft(market.closesAt)}d`;
}

function StatusTag({ market }: { market: Market }) {
  if (market.status === "open")
    return <span className="tag tag-outline">Open</span>;
  if (market.status === "closed")
    return (
      <span className="tag tag-neutral">
        <Lock size={12} />
        Closed
      </span>
    );
  return (
    <span className={`tag ${styles.resolvedTag}`}>
      <Flag size={12} />
      Resolved · {market.resolution.outcome}
    </span>
  );
}

/** Yes and No, each with its move. No wears its own coral, as in 04.1. */
function Prices({ market, phone }: { market: Market; phone: boolean }) {
  const settled = market.status === "resolved";
  return (
    <>
      {(["Yes", "No"] as const).map((o) => {
        const price = o === "Yes" ? market.yesPrice : complement(market.yesPrice);
        const move = o === "Yes" ? market.change : -market.change;
        return (
          <div key={o} className={styles.price} data-side={o}>
            <span className={styles.priceLabel}>
              {phone ? o : `${o} · ${settled ? "settled" : "last price"}`}
            </span>
            <Flash value={price} className={styles.priceValue}>
              {price}¢
            </Flash>
            <span className={styles.priceMove}>
              {market.status === "open"
                ? `${changeText(move)}${phone ? " 24h" : " · 24h"}`
                : settled
                  ? "Final"
                  : "Trading halted"}
            </span>
          </div>
        );
      })}
    </>
  );
}

function Stats({ market, phone }: { market: Market; phone: boolean }) {
  // People on Hunch holding either side, as the server counts them.
  const holders = (market.holders.yes + market.holders.no).toLocaleString("en-US");
  const stats: [string, string][] = phone
    ? [
        ["Volume", compactUsd(market.volumeCents)],
        ["On imo", holders],
        ["Open int.", compactUsd(market.openInterestCents)],
      ]
    : [
        ["Volume", compactUsd(market.volumeCents)],
        ["Open interest", compactUsd(market.openInterestCents)],
        ["imo holders", holders],
        [
          "Implied",
          market.status === "resolved"
            ? `Resolved ${market.resolution.outcome}`
            : `${market.yesPrice}% Yes`,
        ],
      ];
  return (
    <dl className={styles.stats}>
      {stats.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 04 · a market: its question and prices, the chart, the book, the tape,
 * the rules, related markets and the discussion, beside a live ticket.
 * Phones get 04.2 — tabs, and Buy Yes / Buy No at the thumb.
 */
export function MarketDetail({ id }: { id: string }) {
  const { services, state } = useDemo();
  useLive("market", id);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const phone = useMediaQuery("(max-width: 600px)");
  const docked = useMediaQuery("(min-width: 901px)");
  const market = services.markets.get(id);
  const outcome: Outcome = params.get("outcome") === "No" ? "No" : "Yes";
  const side: Side = params.get("side") === "Sell" ? "Sell" : "Buy";
  const preview = usePreviewState();
  const loading = useLoadingView();
  const [sheet, setSheet] = useState<{ outcome: Outcome; side: Side } | null>(
    null,
  );
  const [composer, setComposer] = useState<{ text: string } | null>(null);
  // A deep link with ?trade=1 opens the ticket where it isn't docked.
  useEffect(() => {
    if (
      params.get("trade") === "1" &&
      !window.matchMedia("(min-width: 901px)").matches
    )
      queueMicrotask(() => setSheet({ outcome, side }));
  }, [params, outcome, side]);

  // On its way: the page's shape. "Isn't available" is for what the server
  // says isn't there.
  if (loading || (!market && services.pending("market", id))) return <MarketLoading docked={docked} />;
  if (!market)
    return (
      <Empty
        title="This market isn’t available"
        description="It may have been delisted, or the link is mistyped."
        action={
          <Link className="btn btn-primary" href="/discover">
            Back to Discover
          </Link>
        }
      />
    );
  const paused = preview === "error";
  const retry = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("state");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const held = state.positions.filter((p) => p.marketId === market.id);
  const compose = (text: string) => setComposer({ text });

  return (
    <div
      className={styles.page}
      data-docked={docked || undefined}
      data-phone={phone || undefined}
    >
      <div className={styles.main} data-panel-body>
        {phone && <PhoneBar market={market} />}
        <header className={styles.head}>
          {!phone && (
            <div className={styles.crumbs}>
              <nav aria-label="Breadcrumb">
                <Link href="/discover">Discover</Link>
                <span aria-hidden="true">/</span>
                <Link
                  href={`/discover?category=${encodeURIComponent(market.category)}`}
                >
                  {market.category}
                </Link>
              </nav>
              <span className="tag tag-neutral">
                {venueName(market.venueId)}
              </span>
              <StatusTag market={market} />
              <span className={styles.closes}>{closing(market)}</span>
              <span className={styles.headActions}>
                <SaveToList
                  market={market}
                  triggerClassName={`btn btn-secondary ${styles.watch}`}
                  savedClassName={styles.watched}
                />
                <ShareButton market={market} />
              </span>
            </div>
          )}
          {phone && (
            <div className={styles.tags}>
              <StatusTag market={market} />
              <span className="tag tag-neutral">{closing(market, true)}</span>
              <span className="tag tag-accent">PAPER</span>
            </div>
          )}
          <h1 className={styles.title}>{market.title}</h1>
          <div className={styles.quote}>
            <Prices market={market} phone={phone} />
            {!phone && (
              <>
                <span className={styles.flex} />
                <Stats market={market} phone={false} />
              </>
            )}
          </div>
          {phone && (
            <>
              <MarketChart market={market} compact />
              <Stats market={market} phone />
            </>
          )}
        </header>

        {phone ? (
          <PhoneTabs
            market={market}
            paused={paused}
            onCompose={compose}
            onRetry={retry}
          />
        ) : (
          <>
            <section className={styles.chart} aria-label="Price chart">
              <MarketChart market={market} />
            </section>
            <div className={styles.trio}>
              <OrderBook market={market} stale={paused} />
              <RecentTrades market={market} />
              <Rules market={market} />
            </div>
            <div className={styles.duo}>
              <Related market={market} />
              <Discussion market={market} onCompose={compose} />
            </div>
            {!docked && paused && (
              <div className={styles.inlineError}>
                <BookError market={market} onRetry={retry} />
              </div>
            )}
            {!docked && market.status !== "open" && (
              <div className={styles.inlineState}>
                <MarketState market={market} />
              </div>
            )}
          </>
        )}
        {!docked && market.status === "open" && (
          <TradeBar
            market={market}
            paused={paused}
            onBuy={(o) => setSheet({ outcome: o, side: "Buy" })}
          />
        )}
      </div>

      {docked && (
        <aside className={styles.aside} aria-label="Trade">
          {paused ? (
            <div className={styles.asideBody}>
              <BookError market={market} onRetry={retry} />
            </div>
          ) : (
            <TradeTicket
              key={`${market.id}-${outcome}-${side}`}
              market={market}
              initialOutcome={outcome}
              initialSide={side}
            />
          )}
          {market.status === "open" && held.length > 0 && (
            <PositionSummary market={market} />
          )}
        </aside>
      )}

      {!docked && (
        <TradeSheet
          key={sheet ? `sheet-${sheet.outcome}-${sheet.side}` : "sheet"}
          market={market}
          open={!!sheet}
          onOpenChange={(open) => {
            if (!open) setSheet(null);
          }}
          initialOutcome={sheet?.outcome ?? outcome}
          initialSide={sheet?.side ?? side}
        />
      )}
      <Composer
        key={composer ? `composer-${composer.text}` : "composer"}
        open={!!composer}
        onOpenChange={(open) => {
          if (!open) setComposer(null);
        }}
        marketId={market.id}
        initialOutcome={held[0]?.outcome ?? "Yes"}
        initialText={composer?.text ?? ""}
      />
    </div>
  );
}

/** 04.2 · back, where you are, save and share. */
function PhoneBar({ market }: { market: Market }) {
  const router = useRouter();
  return (
    <div className={styles.phoneBar}>
      <button
        type="button"
        className={`btn btn-icon ${styles.phoneIcon}`}
        aria-label="Back"
        onClick={() =>
          window.history.length > 1 ? router.back() : router.push("/discover")
        }
      >
        <CaretLeft size={20} />
      </button>
      <span className={styles.phoneCrumb}>
        {market.category} · {venueName(market.venueId)}
      </span>
      <SaveToList
        market={market}
        iconOnly
        triggerClassName={`btn btn-icon ${styles.phoneIcon}`}
        savedClassName={styles.watched}
      />
      <ShareButton market={market} iconOnly />
    </div>
  );
}

/** 04.2 · Overview · Book · Trades · Rules · Discussion. */
function PhoneTabs({
  market,
  paused,
  onCompose,
  onRetry,
}: {
  market: Market;
  paused: boolean;
  onCompose: (text: string) => void;
  onRetry: () => void;
}) {
  const { services, state } = useDemo();
  const [tab, setTab] = useState<Tab>("Overview");
  const [rules, setRules] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const book = services.markets.orderBook(market.id);
  const bookFeed = services.markets.feed("book", market.id);
  const posts = state.posts
    .filter((p) => p.marketId === market.id)
    .toSorted(
      (a, b) =>
        b.likes + (b.commentCount ?? b.comments.length) * 2 - (a.likes + (a.commentCount ?? a.comments.length) * 2),
    );
  const onKey = (event: React.KeyboardEvent) => {
    const at = TABS.indexOf(tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    setTab(TABS[to]);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [to]?.focus();
  };
  return (
    <>
      <div
        ref={list}
        className={styles.tabs} data-indicator="line"
        role="tablist"
        aria-label="Market sections"
        onKeyDown={onKey}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        className={styles.tabPanel}
      >
        {tab === "Overview" && (
          <>
            {paused && <BookError market={market} onRetry={onRetry} />}
            {market.status === "open" ? (
              <PositionSummary market={market} variant="card" />
            ) : (
              <div className={styles.stateCard}>
                <MarketState market={market} />
              </div>
            )}
            <div className={styles.overview}>
              {market.status === "open" && (
                <>
                  <h2 className={styles.overviewHead}>Order book · top</h2>
                  <div className={styles.topBook}>
                    <div>
                      <span className={styles.muted}>Bids (Yes)</span>
                      {book.bids.slice(0, 3).map((l, i) => (
                        <span key={l.priceCents} data-first={!i || undefined}>
                          {l.priceCents}¢ · {l.shares.toLocaleString("en-US")}
                        </span>
                      ))}
                      {!book.bids.length && <span className={styles.muted}>{bookFeed === "ready" ? "No bids right now" : bookFeed === "loading" ? "Loading…" : "Unavailable right now"}</span>}
                    </div>
                    <div data-side="ask">
                      <span className={styles.muted}>Asks (Yes)</span>
                      {book.asks.slice(0, 3).map((l, i) => (
                        <span key={l.priceCents} data-first={!i || undefined}>
                          {l.priceCents}¢ · {l.shares.toLocaleString("en-US")}
                        </span>
                      ))}
                      {!book.asks.length && <span className={styles.muted}>{bookFeed === "ready" ? "No asks right now" : bookFeed === "loading" ? "Loading…" : "Unavailable right now"}</span>}
                    </div>
                  </div>
                </>
              )}
              <h2 className={styles.overviewHead}>Rules</h2>
              <p className={styles.overviewRule}>
                {market.resolution.rule.split(". ")[0]}.{" "}
                {market.resolution.source.trim() && `Source: ${market.resolution.source}. `}
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => setRules(true)}
                >
                  Full rules
                </button>
              </p>
              <h2 className={styles.overviewHead}>Top discussion</h2>
              {posts.slice(0, 2).map((p) => (
                <Comment key={p.id} post={p} />
              ))}
              {!posts.length && (
                <p className={styles.muted}>No predictions here yet.</p>
              )}
              {!!services.markets.related(market.id)?.length && (
                <h2 className={styles.overviewHead}>Related</h2>
              )}
              {(services.markets.related(market.id) ?? []).slice(0, 3).map((m) => (
                <Link
                  key={m.id}
                  href={`/market/${m.id}`}
                  className={styles.relatedRow}
                >
                  <span>{m.shortTitle}</span>
                  <b>{m.yesPrice}¢</b>
                </Link>
              ))}
            </div>
            <RulesDialog market={market} open={rules} onOpenChange={setRules} />
          </>
        )}
        {tab === "Book" && (
          <OrderBook market={market} stale={paused} levels={5} />
        )}
        {tab === "Trades" && <RecentTrades market={market} />}
        {tab === "Rules" && <Rules market={market} />}
        {tab === "Discussion" && (
          <>
            <p className="sr-only">{discussionSize(posts)} posts and replies</p>
            <Discussion market={market} onCompose={onCompose} />
          </>
        )}
      </div>
    </>
  );
}
