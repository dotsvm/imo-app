"use client";
/* The panels of 04.1 / 04.2: order book, recent trades, resolution rules,
   related markets, discussion and your position, with the header's
   watchlist and share controls. */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Market, Outcome, Post, RecentTrade } from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import { bestAsk, bestBid } from "@imo/domain/engine";
import { arrowUsd, usd } from "@imo/domain/money";
import {
  ArrowClockwise,
  ArrowRight,
  Export,
  Info,
  WifiSlash,
} from "@/components/icons";
import { Avatar, Modal, relativeTime } from "@/components/ui";
import { Spark } from "@/components/market-bits";
import { Bone } from "@/components/skeleton";
import { statusLine } from "./discover-model";
import styles from "./market.module.css";
import { venueName } from "@/data/venues";
import { dataNow } from "@/data/clock";

export function PanelHead({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.panelHead}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** A venue's contract id as people can read it. Polymarket's are 66
    characters of hex ("0xdf8e…7d4a"); short ones (Kalshi tickers) stay whole. */
export const contractLabel = (id: string) => (id.length > 20 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

/** Rows standing in for a book or tape the venue hasn't answered for yet. */
function LoadingRows({ rows }: { rows: number }) {
  return (
    <div className={styles.loadingRows} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i}>
          <Bone w={i % 2 ? "38%" : "46%"} h={10} />
          <Bone w={44} h={10} />
        </span>
      ))}
    </div>
  );
}

/** 04.1 · the Yes book: asks above the spread, bids below, depth as bars. */
export function OrderBook({
  market,
  stale = false,
  levels = 4,
}: {
  market: Market;
  stale?: boolean;
  levels?: number;
}) {
  const { services } = useDemo();
  const book = services.markets.orderBook(market.id);
  const feed = services.markets.feed("book", market.id);
  const asks = book.asks.slice(0, levels).toReversed();
  const bids = book.bids.slice(0, levels);
  const open = market.status === "open";
  return (
    <section className={styles.panel} aria-labelledby={`${market.id}-book`}>
      <div className={styles.panelHead}>
        <h2 id={`${market.id}-book`}>Order book · Yes</h2>
        <span className={styles.meta}>{venueName(market.venueId)}</span>
      </div>
      {!open ? (
        <p className={styles.panelNote}>
          {market.status === "closed"
            ? "Trading is halted, so the book is closed until the market resolves."
            : "The market has resolved. There is no book."}
        </p>
      ) : feed === "unavailable" ? (
        <p className={styles.panelNote} role="status">
          The order book isn’t available right now. {venueName(market.venueId)} didn’t answer; the last
          price is {market.yesPrice}¢.
        </p>
      ) : feed === "loading" ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading the order book…</span>
          <LoadingRows rows={levels * 2} />
        </div>
      ) : (
        <div className={styles.book} data-stale={stale || undefined}>
          <div className={styles.bookHead} aria-hidden="true">
            <span>Price</span>
            <span>Shares</span>
          </div>
          <table>
            <caption className="sr-only">
              Yes order book on {venueName(market.venueId)}
              {stale ? ", may be stale" : ""}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Price</th>
                <th scope="col">Shares</th>
              </tr>
            </thead>
            <tbody>
              {asks.map((l) => (
                <tr
                  key={`a${l.priceCents}`}
                  data-side="ask"
                  style={
                    { "--depth": `${l.depthPercent}%` } as React.CSSProperties
                  }
                >
                  <th scope="row">Ask {l.priceCents}¢</th>
                  <td>{l.shares.toLocaleString("en-US")}</td>
                </tr>
              ))}
              <tr className={styles.spread}>
                <th scope="row">
                  {/* A side can be empty on a live book, or still loading. */}
                  Spread{" "}
                  {book.asks[0] && book.bids[0]
                    ? `${Math.round((book.asks[0].priceCents - book.bids[0].priceCents) * 10) / 10}¢`
                    : "—"}
                </th>
                <td>Last {market.yesPrice}¢</td>
              </tr>
              {bids.map((l) => (
                <tr
                  key={`b${l.priceCents}`}
                  data-side="bid"
                  style={
                    { "--depth": `${l.depthPercent}%` } as React.CSSProperties
                  }
                >
                  <th scope="row">Bid {l.priceCents}¢</th>
                  <td>{l.shares.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stale && (
            <p className={styles.staleNote}>
              <WifiSlash size={13} />
              Book not updating · prices may be stale
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** When a trade printed, Eastern time: to the second where the venue says
    when, else to the minute. */
const tapeTime = (trade: RecentTrade) =>
  new Date(trade.at ? Date.parse(trade.at) : dataNow() - trade.minutesAgo * 60_000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    ...(trade.at ? { second: "2-digit" as const } : {}),
  });

/** 04.1 · the tape: when, which side, at what price, how many. */
export function RecentTrades({ market }: { market: Market }) {
  const { services } = useDemo();
  const trades = services.markets.recentTrades(market.id);
  const feed = services.markets.feed("trades", market.id);
  return (
    <section className={styles.panel} aria-labelledby={`${market.id}-tape`}>
      <div className={styles.panelHead}>
        <h2 id={`${market.id}-tape`}>Recent trades</h2>
        {/* "Live" only once the tape is actually coming in. */}
        {market.status === "open" && feed === "ready" && (
          <span className={styles.live}>
            <span aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      {market.status !== "open" ? (
        <p className={styles.panelNote}>No trades since the market closed.</p>
      ) : feed === "unavailable" ? (
        <p className={styles.panelNote} role="status">
          Recent trades aren’t available right now.
        </p>
      ) : feed === "loading" ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading recent trades…</span>
          <LoadingRows rows={6} />
        </div>
      ) : !trades.length ? (
        <p className={styles.panelNote}>No trades on {venueName(market.venueId)} yet.</p>
      ) : (
        <table className={styles.tape}>
          <caption className="sr-only">
            Recent trades on {venueName(market.venueId)}
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Time (ET)</th>
              <th scope="col">Side</th>
              <th scope="col">Price</th>
              <th scope="col">Shares</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{tapeTime(t)}</td>
                <th scope="row" data-side={t.outcome}>
                  {t.outcome}
                </th>
                <td>{t.priceCents}¢</td>
                <td>{t.shares.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const closeStamp = (market: Market) =>
  `${new Date(market.closesAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  })} · ${new Date(market.closesAt).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  })} ET`;

/** Bold the outcomes where the rule names them: "Resolves **Yes** if…". */
function RuleText({ text }: { text: string }) {
  const parts = text.split(/(Resolve[sd] (?:Yes|No))/);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^(Resolve[sd]) (Yes|No)$/);
        return m ? (
          <span key={i}>
            {m[1]} <b>{m[2]}</b>
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

/** `full`: the whole contract id (the rules dialog); the panel shortens it. */
function RuleFacts({ market, full = false }: { market: Market; full?: boolean }) {
  const id = market.venueContractId;
  return (
    <dl className={styles.facts}>
      {market.resolution.source.trim() && (
        <>
          <dt>Source</dt>
          <dd>{market.resolution.source}</dd>
        </>
      )}
      <dt>Closes</dt>
      <dd>{closeStamp(market)}</dd>
      <dt>Payout</dt>
      <dd>$1.00 per winning share</dd>
      <dt>Venue</dt>
      <dd>
        {venueName(market.venueId)} · market{" "}
        {full ? id : <span title={id}>{contractLabel(id)}</span>}
      </dd>
    </dl>
  );
}

/** The whole contract, for when the summary isn't enough. */
export function RulesDialog({
  market,
  open,
  onOpenChange,
}: {
  market: Market;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Rules · ${contractLabel(market.venueContractId)}`}
      description={market.title}
    >
      <div className={styles.rulesFull}>
        <p>
          <RuleText text={market.resolution.rule} />
        </p>
        <RuleFacts market={market} full />
        {/* Polymarket's description is its rule again: say it once. */}
        {market.description.trim() && market.description.trim() !== market.resolution.rule.trim() && (
          <p className={styles.muted}>{market.description}</p>
        )}
        <p className={styles.notice}>
          <Info size={15} />
          Similar questions on other venues can have different deadlines or
          rules. These contracts are not interchangeable.
        </p>
      </div>
    </Modal>
  );
}

/** 04.1 · resolution rules: the rule, its source, close, payout and venue. */
export function Rules({ market }: { market: Market }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.panel} aria-labelledby={`${market.id}-rules`}>
      <div className={styles.panelHead}>
        <h2 id={`${market.id}-rules`}>Resolution rules</h2>
      </div>
      <div className={styles.rules}>
        <p>
          <RuleText text={market.resolution.rule} />
        </p>
        <RuleFacts market={market} />
        <button
          type="button"
          className={styles.more}
          onClick={() => setOpen(true)}
        >
          Full rules
          <ArrowRight size={13} />
        </button>
      </div>
      <RulesDialog market={market} open={open} onOpenChange={setOpen} />
    </section>
  );
}

/** 04.1 · related markets: title, venue and status, the line, Yes. */
export function Related({ market }: { market: Market }) {
  const { services } = useDemo();
  const related = (services.markets.related(market.id) ?? []).slice(0, 4);
  if (!related.length) return null;
  return (
    <section className={styles.panel} aria-labelledby={`${market.id}-related`}>
      <div className={styles.panelHead}>
        <h2 id={`${market.id}-related`}>Related markets</h2>
      </div>
      {related.map((m) => (
        <Link key={m.id} href={`/market/${m.id}`} className={styles.related}>
          <span>
            <b>{m.shortTitle}</b>
            <span>
              {venueName(m.venueId)} · {statusLine(m)}
            </span>
          </span>
          <Spark
            data={m.series}
            change={m.status === "open" ? m.change : 0}
            viewBox={[120, 28]}
            className={styles.relatedSpark}
          />
          <b>{m.yesPrice}¢</b>
        </Link>
      ))}
    </section>
  );
}

const SORTS = ["Top", "Newest", "Holders only"] as const;
type Sort = (typeof SORTS)[number];
const holds = (p: Post) => p.disclosePosition && p.evidenceShares > 0;
export const positionTag = (p: Post) =>
  holds(p)
    ? `Holds ${p.evidenceShares.toLocaleString("en-US")} ${p.outcome}`
    : "No position";
export const discussionSize = (posts: Post[]) =>
  posts.reduce((n, p) => n + 1 + (p.commentCount ?? p.comments.length), 0);

/** 04.1 · discussion: the market's predictions, a reply box that becomes
    one, and Top / Newest / Holders only. */
export function Discussion({
  market,
  onCompose,
}: {
  market: Market;
  onCompose: (text: string) => void;
}) {
  const { state, services } = useDemo();
  const [sort, setSort] = useState<Sort>("Top");
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const posts = state.posts.filter((p) => p.marketId === market.id);
  const shown = (
    sort === "Holders only" ? posts.filter(holds) : posts
  ).toSorted(
    sort === "Newest"
      ? (a, b) => Date.parse(b.at) - Date.parse(a.at)
      : (a, b) =>
          b.likes + (b.commentCount ?? b.comments.length) * 2 - (a.likes + (a.commentCount ?? a.comments.length) * 2),
  );
  const you = services.profiles.get("you");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCompose(draft.trim());
    setDraft("");
  };
  return (
    <section className={styles.panel} aria-labelledby={`${market.id}-talk`}>
      <div className={styles.panelHead}>
        <h2 id={`${market.id}-talk`}>
          Discussion · {discussionSize(posts).toLocaleString("en-US")}
        </h2>
        <span className={styles.flex} />
        <div className={styles.sorts} role="group" aria-label="Sort discussion">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <form className={styles.reply} onSubmit={submit}>
        {you && <Avatar trader={you} size={28} />}
        <label htmlFor={inputId} className="sr-only">
          Your reasoning on {market.shortTitle}
        </label>
        <input
          id={inputId}
          className="input"
          placeholder="Add your reasoning — link your position to post it as a prediction"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary">
          Post
        </button>
      </form>
      {shown.length ? (
        shown.map((p) => <Comment key={p.id} post={p} />)
      ) : (
        <p className={styles.panelNote}>
          {sort === "Holders only"
            ? "No one holding this market has posted yet."
            : "No predictions on this market yet. Share your take first."}
        </p>
      )}
    </section>
  );
}

export function Comment({
  post,
  clamp = true,
}: {
  post: Post;
  clamp?: boolean;
}) {
  const { services } = useDemo();
  const author = services.profiles.get(post.authorId);
  if (!author) return null;
  return (
    <Link href={`/post/${post.id}`} className={styles.comment}>
      <Avatar trader={author} size={28} />
      <span className={styles.commentBody}>
        <span className={styles.commentHead}>
          <b>{author.name}</b>
          <span className="tag tag-neutral">{positionTag(post)}</span>
          <span className={styles.muted}>{relativeTime(post.at)}</span>
        </span>
        <span className={styles.commentText} data-clamp={clamp || undefined}>
          {post.text}
        </span>
      </span>
    </Link>
  );
}

/** 04.1 · your position, marked to the bid, with the same fee-inclusive
    cost basis the position page uses. */
export function PositionSummary({
  market,
  variant = "aside",
}: {
  market: Market;
  variant?: "aside" | "card";
}) {
  const { state } = useDemo();
  const held = state.positions.filter((p) => p.marketId === market.id);
  if (!held.length) return null;
  return (
    <div className={styles.position} data-variant={variant}>
      <span className={styles.label}>Your position</span>
      {held.map((p) => {
        const bid = bestBid(market, p.outcome);
        const value = p.shares * bid;
        const basis = p.costCents + p.feeCents;
        const pnl = value - basis;
        const avg = Math.round((p.costCents / p.shares) * 10) / 10;
        return (
          <Link
            key={p.id}
            href={`/position/${p.id}`}
            className={styles.positionLink}
          >
            <b>
              {p.shares.toLocaleString("en-US")} {p.outcome} · avg {avg}¢
            </b>
            <b>{usd(value)}</b>
            <span className={styles.muted}>
              {variant === "card"
                ? `Cost ${usd(basis)}`
                : `Cost basis ${usd(basis)} · bid ${bid}¢`}
            </span>
            <span data-tone={pnl < 0 ? "neg" : "pos"}>
              {arrowUsd(pnl)}
              {variant === "aside" ? " unrealized" : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Share: the system sheet where there is one, otherwise copy the link. */
export function ShareButton({
  market,
  iconOnly = false,
}: {
  market: Market;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const share = async () => {
    const url = `${window.location.origin}/market/${market.id}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: market.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Dismissed or blocked: nothing to undo.
    }
  };
  return (
    <>
      <button
        type="button"
        className={
          iconOnly
            ? `btn btn-icon ${styles.phoneIcon}`
            : `btn btn-secondary btn-icon ${styles.tipped}`
        }
        aria-label="Share market"
        data-tip={copied ? "Link copied" : "Share"}
        data-copied={copied || undefined}
        onClick={share}
      >
        <Export size={iconOnly ? 18 : 15} />
      </button>
      <span className="sr-only" role="status">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}

/** 04.8 · the book didn't load: say so, pause trading, offer a retry. */
export function BookError({
  market,
  onRetry,
}: {
  market: Market;
  onRetry: () => void;
}) {
  return (
    <div className={styles.bookError} role="alert">
      <WifiSlash size={24} />
      <b>Couldn’t load the order book</b>
      <span>
        {venueName(market.venueId)} didn’t respond in 5 seconds. Prices shown
        may be stale — trading is paused until the book reloads.
      </span>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          <ArrowClockwise size={15} />
          Retry
        </button>
        <Link href="/settings?section=connected" className="btn btn-secondary">
          Venue status
        </Link>
      </div>
    </div>
  );
}

/** 04.7 · the page's shape in skeleton, never a spinner. */
export function MarketLoading({ docked }: { docked: boolean }) {
  return (
    <div
      className={styles.page}
      data-docked={docked || undefined}
      role="status"
      aria-label="Loading market"
      aria-busy="true"
    >
      <div className={styles.main}>
        <div className={styles.skeleton} aria-hidden="true">
          <div className={styles.skRow}>
            <span style={{ width: 80, height: 14 }} />
            <span style={{ width: 60, height: 14 }} />
          </div>
          <span style={{ width: "70%", height: 30 }} />
          <span style={{ width: "40%", height: 30 }} />
          <div className={styles.skRow} data-gap="wide">
            <span style={{ width: 100, height: 48 }} />
            <span style={{ width: 100, height: 48 }} />
          </div>
          <span className={styles.skChart} />
          <div className={styles.skTrio}>
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      {docked && (
        <aside className={styles.aside} aria-hidden="true">
          <div className={styles.skeleton}>
            <span style={{ height: 38, borderRadius: 999 }} />
            <div className={styles.skRow}>
              <span style={{ flex: 1, height: 48, borderRadius: 999 }} />
              <span style={{ flex: 1, height: 48, borderRadius: 999 }} />
            </div>
            <span style={{ height: 56 }} />
            <span style={{ height: 180 }} />
            <span style={{ height: 52, borderRadius: 999 }} />
          </div>
        </aside>
      )}
    </div>
  );
}

/** 04.2 · Buy Yes / Buy No, pinned to the bottom of a phone or tablet. */
export function TradeBar({
  market,
  paused,
  onBuy,
}: {
  market: Market;
  paused: boolean;
  onBuy: (outcome: Outcome) => void;
}) {
  return (
    <div className={styles.tradeBar}>
      {(["Yes", "No"] as const).map((o) => (
        <button
          key={o}
          type="button"
          data-side={o}
          disabled={paused}
          onClick={() => onBuy(o)}
        >
          <b>
            Buy {o} {bestAsk(market, o)}¢
          </b>
          <span>{paused ? "Trading paused" : "Payout $1.00 / share"}</span>
        </button>
      ))}
    </div>
  );
}
