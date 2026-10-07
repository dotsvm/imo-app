"use client";
/* 11 · Portfolio. 11.1: the account in a stat strip, a claim banner,
   tabbed tables and an activity rail. 11.2: on a phone, the account value
   first, then one tidy list per tab. */
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CaretRight,
  ChartPieSlice,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Flag,
  History,
  RotateCcw,
  Wallet,
  X,
} from "@/components/icons";
import { useDemo, useLoadingView, useSeason, usePreviewState } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import {
  availableCash,
  averageEntry,
  bestBid,
  portfolioTotals,
} from "@imo/domain/engine";
import { centsText, usd, signedUsd } from "@imo/domain/money";
import { isVenueId, venueIds, venueName } from "@/data/venues";
import type { Activity, ClosedPosition, Order, Position } from "@imo/domain/types";
import { SignInWall, Button, Empty } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import styles from "./portfolio.module.css";

const ALL_VENUES = "All venues";
const VENUES = [ALL_VENUES, ...venueIds];

const pct = (part: number, whole: number, digits = 1) =>
  whole
    ? `${part >= 0 ? "+" : "−"}${Math.abs((part / whole) * 100).toFixed(digits)}%`
    : "—";
const cents = (n: number) => `${Math.round(n * 10) / 10}¢`;
const stamp = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const orderStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

/** Signed money with a direction glyph, so loss never reads as gain. */
function Money({ value, bold = false }: { value: number; bold?: boolean }) {
  const cls = value > 0 ? styles.up : value < 0 ? styles.down : styles.flat;
  const glyph = value > 0 ? "▲" : value < 0 ? "▼" : "■";
  const body = (
    <>
      {glyph} {signedUsd(value)}
    </>
  );
  return bold ? (
    <b className={cls}>{body}</b>
  ) : (
    <span className={cls}>{body}</span>
  );
}

const activityIcon = (a: Activity) => {
  if (a.kind === "claim") return <Flag size={16} />;
  if (a.kind === "order")
    return a.title.startsWith("Order failed") ? (
      <CircleX size={16} />
    ) : a.title.startsWith("Partial") ? (
      <CircleDashed size={16} />
    ) : (
      <Clock size={16} />
    );
  if (a.kind === "sell")
    return a.amountCents >= 0 ? (
      <ArrowUpRight size={16} />
    ) : (
      <ArrowDownRight size={16} />
    );
  return a.title === "Paper balance" || a.title.startsWith("Demo account") ? (
    <Wallet size={16} />
  ) : (
    <CircleCheck size={16} />
  );
};

type Model = ReturnType<typeof usePortfolio>;

/** Everything both layouts read, and what they can do. */
function usePortfolio() {
  const { state, services } = useDemo();
  const { startCents } = useSeason();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") || "Open positions";
  const asked = params.get("venue");
  const venue = isVenueId(asked) ? asked : ALL_VENUES;
  const [notice, setNotice] = useState("");
  const totals = portfolioTotals(state, services.markets.list());
  const market = (id: string) => services.markets.get(id)!;
  const open = state.positions.filter(
    (p) => market(p.marketId).status !== "resolved",
  );
  // What settlement booked: winners $1 a share, void markets 50¢; losing
  // positions close on their own.
  const payouts = new Map(state.claimable.map((c) => [c.positionId, c.payoutCents]));
  const claimable = state.positions.filter((p) => payouts.has(p.id));
  const payoutOf = (p: Position) => payouts.get(p.id) ?? 0;
  const liveOrders = [
    ...state.orders.filter(
      (o) => o.status === "pending" || o.status === "partial",
    ),
    ...state.orders.filter((o) => o.status === "failed"),
  ];
  // Open positions are worth what they'd sell for now: the bid.
  const valueOf = (p: Position) =>
    p.shares * bestBid(market(p.marketId), p.outcome);
  const basisOf = (p: Position) => p.costCents + p.feeCents;
  const sum = (list: Position[], fn: (p: Position) => number) =>
    list.reduce((s, p) => s + fn(p), 0);
  const openValue = sum(open, valueOf);
  const openBasis = sum(open, basisOf);
  const shown = open.filter(
    (p) => venue === ALL_VENUES || market(p.marketId).venueId === venue,
  );
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== "All venues" && value !== "Open positions")
      next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `/portfolio?${qs}` : "/portfolio", { scroll: false });
  };
  const operate = (fn: () => void | Promise<unknown>, message: string) => {
    try {
      const result = fn();
      if (result instanceof Promise)
        result.then(() => setNotice(message)).catch((e: unknown) => setNotice((e as Error).message));
      else setNotice(message);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  return {
    state,
    market,
    tab,
    venue,
    setParam,
    notice,
    setNotice,
    totals,
    allTime: totals.totalCents - startCents,
    startCents,
    available: availableCash(state),
    reserved: state.cashCents - availableCash(state),
    open,
    claimable,
    liveOrders,
    shown,
    valueOf,
    basisOf,
    openValue,
    openBasis,
    shownValue: sum(shown, valueOf),
    shownBasis: sum(shown, basisOf),
    claimValue: sum(claimable, payoutOf),
    payoutOf,
    claimBasis: sum(claimable, basisOf),
    closedFees: state.closed.reduce(
      (s, p) => s + p.feeCents + p.exitFeeCents,
      0,
    ),
    realizedOf: (p: ClosedPosition) =>
      p.proceedsCents - p.exitFeeCents - p.costCents - p.feeCents,
    claim: (p: Position) =>
      services.portfolio
        .claim(p.id)
        .then((receipt) =>
          setNotice(`${usd(receipt.payoutCents)} claimed to your cash balance. Position moved to Closed.`),
        )
        .catch((e: unknown) => setNotice((e as Error).message)),
    cancel: (o: Order) =>
      operate(
        () => services.orders.cancel(o.id),
        "Order cancelled. Reserved funds or shares have been released.",
      ),
  };
}

const orderAction = (o: Order) =>
  o.status === "failed"
    ? "Retry"
    : o.status === "partial"
      ? "Cancel rest"
      : "Cancel";
const orderStatus = (o: Order) =>
  o.status === "failed"
    ? "Failed · no liquidity"
    : o.status === "partial"
      ? "Partially filled"
      : "Pending";

export function Portfolio() {
  const { state } = useDemo();
  if (state.signedOut)
    return <SignInWall title="Your portfolio lives here" description="Log in to see your paper balance, positions, orders and activity." />;
  return <PortfolioPage />;
}

function PortfolioPage() {
  const phone = useMediaQuery("(max-width: 600px)");
  const model = usePortfolio();
  const preview = usePreviewState();
  const loading = useLoadingView();
  // Until your account arrives: its shape, not "No positions yet".
  if (loading) return <PortfolioLoading phone={phone} />;
  if (preview === "error")
    return (
      <div className={styles.stateWrap}>
        <Empty
          title="Your portfolio didn’t load"
          description="Your positions and cash are safe. Try again in a moment."
          action={
            <Link href="/portfolio" className="btn btn-primary">
              Try again
              <RotateCcw size={15} />
            </Link>
          }
        />
      </div>
    );
  if (
    preview === "empty" ||
    (!model.state.positions.length &&
      !model.state.closed.length &&
      !model.state.orders.length)
  )
    return (
      <div className={styles.stateWrap}>
        <h1 className="sr-only">Your portfolio.</h1>
        <NoPositions available={model.available} />
      </div>
    );
  return phone ? <Phone m={model} /> : <Desktop m={model} />;
}

/** 11.3 · no positions yet: what you have, and where to start. */
function NoPositions({ available }: { available: number }) {
  return (
    <div className={styles.empty}>
      <ChartPieSlice size={24} />
      <b>No positions yet</b>
      <p>
        You have {usd(available)} in simulated funds. Pick a market, buy Yes or
        No, and it shows up here.
      </p>
      <Link href="/discover" className="btn btn-primary">
        Browse markets
      </Link>
    </div>
  );
}

const LOADING_POSITIONS = [70, 56, 64, 48, 60];
const LOADING_ACTIVITY = [150, 120, 170, 110, 140, 130, 160];

/** 11.5 · loading keeps the page's shape: the figures, the positions table
    and the activity log, each where it will be. */
function PortfolioLoading({ phone }: { phone: boolean }) {
  if (phone)
    return (
      <Loading label="Loading your portfolio" className={styles.phone}>
        <section className={styles.phoneValue}>
          <div className={styles.phoneValueHead}>
            <span className={styles.statKey}>Account value</span>
          </div>
          <Bone w={180} h={34} style={{ margin: "8px 0" }} />
          <Bone w={150} h={11} />
          <dl className={styles.phoneTrio}>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Bone w={56} h={9} />
                <Bone w={i === 1 ? 60 : 76} h={14} style={{ marginTop: 7 }} />
              </div>
            ))}
          </dl>
        </section>
        <div className={styles.phoneTabs} data-indicator="line" aria-hidden="true">
          {[96, 76, 68].map((w) => (
            <Bone key={w} w={w} h={12} style={{ margin: "16px 10px" }} />
          ))}
        </div>
        <div className={styles.phoneList}>
          {LOADING_POSITIONS.map((w, i) => (
            <div key={i} className={styles.phoneRow}>
              <Bone w={`${w + 14}%`} h={12} className={styles.phoneTitle} />
              <Bone w={64} h={12} className={styles.phoneValueCell} />
              <Bone w={130} h={9} className={styles.phoneMeta} />
              <Bone w={52} h={9} className={styles.phonePnl} />
            </div>
          ))}
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading your portfolio" className={styles.screen}>
      <div className={styles.portfolio}>
        <div className={styles.main}>
          <div className={styles.stats}>
            <div className={styles.headline}>
              <span className={styles.statKey}>Account value</span>
              <Bone w={170} h={30} style={{ margin: "6px 0 8px" }} />
              <Bone w={140} h={10} />
              <Bone w={120} h={9} style={{ marginTop: 6 }} />
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div className={styles.stat} key={i}>
                <Bone w={64} h={9} />
                <Bone w={i % 2 ? 70 : 90} h={20} style={{ margin: "8px 0 6px" }} />
                <Bone w={84} h={9} />
              </div>
            ))}
          </div>
          <div className={styles.tabs} aria-hidden="true">
            {[118, 112, 84, 64].map((w) => (
              <Bone key={w} w={w} h={12} style={{ margin: "15px 12px" }} />
            ))}
            <span className={styles.spacer} />
            <Bone w={210} h={30} r="pill" />
          </div>
          <div className={styles.tableHead}>
            <span>Market</span>
            <span>Side</span>
            <span>Shares</span>
            <span>Avg</span>
            <span>Bid</span>
            <span>Cost basis</span>
            <span>Value</span>
            <span>Unrealized</span>
            <span />
          </div>
          {LOADING_POSITIONS.map((w, i) => (
            <div className={styles.row} key={i}>
              <span className={styles.rowTitle}>
                <Bone w={`${w + 20}%`} h={12} />
                <Bone w={120} h={9} style={{ marginTop: 6 }} />
              </span>
              <Bone w={34} h={20} r={6} />
              {[30, 30, 30, 50, 50].map((cw, c) => (
                <Bone key={c} w={cw} h={11} className={styles.num} style={{ marginLeft: "auto" }} />
              ))}
              <Bone w={60} h={11} style={{ marginLeft: "auto" }} />
              <Bone w={52} h={30} r="pill" style={{ marginLeft: "auto" }} />
            </div>
          ))}
        </div>
        <aside className={styles.aside}>
          <div className={styles.asideHead}>
            <History size={14} />
            <b>Activity</b>
            <span className={styles.spacer} />
            <span className={styles.export}>Export CSV</span>
          </div>
          {LOADING_ACTIVITY.map((w, i) => (
            <div className={styles.activity} key={i}>
              <Bone circle={18} />
              <span className={styles.activityBody}>
                <Bone w={w} h={11} />
                <BoneLines lines={1} h={9} last={`${50 + (i % 3) * 12}%`} />
              </span>
              <span className={styles.activityAmount}>
                <Bone w={52} h={11} />
                <Bone w={34} h={9} />
              </span>
            </div>
          ))}
        </aside>
      </div>
    </Loading>
  );
}

function Notice({ m }: { m: Model }) {
  if (!m.notice) return null;
  return (
    <div className={styles.notice} role="status">
      <Check size={16} />
      <p>{m.notice}</p>
      <button aria-label="Dismiss notification" onClick={() => m.setNotice("")}>
        <X size={15} />
      </button>
    </div>
  );
}

/* --------------------------------------------------------- 11.1 desktop */
function Desktop({ m }: { m: Model }) {
  const { state, market, tab, venue } = m;
  const stats = [
    {
      k: "Cash",
      v: usd(state.cashCents),
      note: `${usd(m.available)} avail. · ${usd(m.reserved)} in orders`,
    },
    {
      k: "Positions",
      v: usd(m.openValue),
      note: `${m.open.length} open · marked to bid`,
    },
    {
      k: "Claimable",
      v: usd(m.claimValue),
      note: `${m.claimable.length} resolved market${m.claimable.length === 1 ? "" : "s"}`,
    },
    {
      k: "Unrealized P&L",
      v: <Money value={m.openValue - m.openBasis} bold />,
      note: "Open positions vs cost",
    },
    {
      k: "Realized P&L",
      v: <Money value={m.totals.realizedCents} bold />,
      note: `Closed · fees paid ${usd(m.closedFees)}`,
    },
  ];
  const tabs: [string, number][] = [
    ["Open positions", m.open.length],
    ["Pending orders", m.liveOrders.length],
    ["Claimable", m.claimable.length],
    ["Closed", state.closed.length],
  ];
  const orders = (
    <>
      <div className={styles.sectionHead}>
        <b>Pending orders</b>
        <span>{usd(m.reserved)} reserved from cash</span>
      </div>
      {m.liveOrders.map((o) => (
        <OrderRow
          key={o.id}
          order={o}
          title={market(o.quote.marketId).title}
          marketId={o.quote.marketId}
          onAction={() => m.cancel(o)}
        />
      ))}
    </>
  );

  return (
    <div className={styles.screen}>
      <h1 className="sr-only">Your portfolio.</h1>
      <div className={styles.portfolio}>
        <div className={styles.main}>
          <div className={styles.stats}>
            <div className={styles.headline}>
              <span className={styles.statKey}>Account value</span>
              <b>{usd(m.totals.totalCents)}</b>
              <span className={styles.allTime}>
                <Money value={m.allTime} /> · {pct(m.allTime, m.startCents, 2)}{" "}
                all time
              </span>
              <span className={styles.statNote}>
                vs {usd(m.startCents)} simulated start
              </span>
            </div>
            {stats.map((s) => (
              <div className={styles.stat} key={s.k}>
                <span className={styles.statKey}>{s.k}</span>
                <b>{s.v}</b>
                <span className={styles.statNote}>{s.note}</span>
              </div>
            ))}
          </div>

          <Notice m={m} />

          {m.claimable.map((p) => {
            const mk = market(p.marketId);
            const payout = m.payoutOf(p);
            return (
              <div className={styles.claim} key={p.id} id="claim">
                <Flag size={18} />
                <div>
                  <b>
                    {mk.shortTitle} resolved {mk.resolution.outcome} — you have{" "}
                    {usd(payout)} to claim
                  </b>
                  <span>
                    {p.shares} {p.outcome} × $1.00 payout. Cost basis{" "}
                    {usd(m.basisOf(p))} → profit{" "}
                    {signedUsd(payout - m.basisOf(p))}. Claiming moves it to
                    cash and books realized P&amp;L.
                  </span>
                </div>
                <Button
                  variant="primary"
                  className={styles.claimButton}
                  onClick={() => m.claim(p)}
                >
                  <span>Claim {usd(payout)}</span>
                  <ArrowRight size={15} />
                </Button>
              </div>
            );
          })}

          <div className={styles.tabs} data-indicator="line">
            {tabs.map(([name, count]) => (
              <button
                key={name}
                className={tab === name ? styles.tabOn : undefined}
                aria-pressed={tab === name}
                onClick={() => m.setParam("tab", name)}
              >
                {name} · {count}
              </button>
            ))}
            <span className={styles.spacer} />
            <div className="seg" data-indicator="pill">
              {VENUES.map((v) => (
                <button
                  key={v}
                  className="seg-opt"
                  aria-pressed={venue === v}
                  onClick={() => m.setParam("venue", v)}
                >
                  {v === ALL_VENUES ? v : venueName(v)}
                </button>
              ))}
            </div>
          </div>

          {tab === "Open positions" &&
            (m.shown.length ? (
              <>
                <div className={styles.tableHead}>
                  <span>Market</span>
                  <span>Side</span>
                  <span>Shares</span>
                  <span>Avg</span>
                  <span>Bid</span>
                  <span>Cost basis</span>
                  <span>Value</span>
                  <span>Unrealized</span>
                  <span />
                </div>
                {m.shown.map((p) => {
                  const mk = market(p.marketId);
                  const basis = m.basisOf(p);
                  const value = m.valueOf(p);
                  const pnl = value - basis;
                  return (
                    <div className={styles.row} key={p.id}>
                      <Link
                        href={`/position/${p.id}`}
                        className={styles.rowTitle}
                      >
                        <b>{mk.title}</b>
                        <span>
                          <span className="venue">{venueName(mk.venueId)}</span>{" "}
                          · payout if right {usd(p.shares * 100)}
                        </span>
                      </Link>
                      <span
                        className={`${styles.side} ${p.outcome === "Yes" ? styles.yes : styles.no}`}
                      >
                        {p.outcome}
                      </span>
                      <span className={styles.num}>
                        {p.shares.toLocaleString()}
                      </span>
                      <span className={styles.num}>
                        {averageEntry(p).toFixed(0)}¢
                      </span>
                      <span className={styles.num}>
                        {bestBid(mk, p.outcome)}¢
                      </span>
                      <span className={styles.num}>{usd(basis)}</span>
                      <b className={styles.num}>{usd(value)}</b>
                      <span className={styles.pnl}>
                        <Money value={pnl} bold />
                        <span className={pnl >= 0 ? styles.up : styles.down}>
                          {pct(pnl, basis)}
                        </span>
                      </span>
                      <Link
                        href={`/market/${mk.id}?side=Sell&outcome=${p.outcome}&trade=1`}
                        className="btn btn-secondary"
                        aria-label={`Sell ${mk.shortTitle}`}
                      >
                        Sell
                      </Link>
                    </div>
                  );
                })}
                <div className={styles.total}>
                  <span>
                    Total · {m.shown.length} open
                    {venue !== ALL_VENUES ? ` on ${venueName(venue)}` : ""}
                  </span>
                  <span>
                    <span>Cost {usd(m.shownBasis)}</span>
                    <span>Value {usd(m.shownValue)}</span>
                    <Money value={m.shownValue - m.shownBasis} />{" "}
                    <span className={styles.unrealizedWord}>unrealized</span>
                  </span>
                </div>
                {m.liveOrders.length > 0 && orders}
              </>
            ) : (
              <Empty
                title={
                  venue === ALL_VENUES
                    ? "No open positions"
                    : `No open positions on ${venueName(venue)}`
                }
                description={`You have ${usd(m.available)} available. Pick a market, buy Yes or No, and it shows up here.`}
                action={
                  <Link href="/discover" className="btn btn-primary">
                    Browse markets
                  </Link>
                }
              />
            ))}

          {tab === "Pending orders" &&
            (m.liveOrders.length ? (
              orders
            ) : (
              <Empty
                title="No orders waiting"
                description="Limit orders that haven’t filled wait here, with the cash they reserve."
                action={
                  <Link href="/discover" className="btn btn-secondary">
                    Browse markets
                  </Link>
                }
              />
            ))}

          {tab === "Claimable" &&
            (m.claimable.length ? (
              <>
                <div className={styles.tableHead} data-variant="claim">
                  <span>Market</span>
                  <span>Side</span>
                  <span>Shares</span>
                  <span>Cost basis</span>
                  <span>Payout</span>
                  <span>Profit on claim</span>
                  <span />
                </div>
                {m.claimable.map((p) => {
                  const mk = market(p.marketId);
                  const payout = m.payoutOf(p);
                  return (
                    <div className={styles.row} data-variant="claim" key={p.id}>
                      <Link
                        href={`/position/${p.id}`}
                        className={styles.rowTitle}
                      >
                        <b>{mk.title}</b>
                        <span>
                          <span className="venue">{venueName(mk.venueId)}</span>{" "}
                          · resolved {mk.resolution.outcome}
                        </span>
                      </Link>
                      <span
                        className={`${styles.side} ${p.outcome === "Yes" ? styles.yes : styles.no}`}
                      >
                        {p.outcome}
                      </span>
                      <span className={styles.num}>
                        {p.shares.toLocaleString()}
                      </span>
                      <span className={styles.num}>{usd(m.basisOf(p))}</span>
                      <b className={styles.num}>{usd(payout)}</b>
                      <span className={styles.pnl}>
                        <Money value={payout - m.basisOf(p)} bold />
                      </span>
                      <Button variant="primary" onClick={() => m.claim(p)}>
                        Claim {usd(payout)}
                      </Button>
                    </div>
                  );
                })}
                <div className={styles.total}>
                  <span>Total · {m.claimable.length} resolved</span>
                  <span>
                    <span>Cost {usd(m.claimBasis)}</span>
                    <span>Payout {usd(m.claimValue)}</span>
                    <Money value={m.claimValue - m.claimBasis} />{" "}
                    <span className={styles.unrealizedWord}>on claim</span>
                  </span>
                </div>
              </>
            ) : (
              <Empty
                title="All settled"
                description="Payouts from your next resolved markets will appear here."
                action={
                  <Link href="/discover" className="btn btn-secondary">
                    Browse markets
                  </Link>
                }
              />
            ))}

          {tab === "Closed" &&
            (state.closed.length ? (
              <>
                <div className={styles.tableHead} data-variant="closed">
                  <span>Market</span>
                  <span>Side</span>
                  <span>Shares</span>
                  <span>In → out</span>
                  <span>Cost basis</span>
                  <span>Realized</span>
                  <span>Closed</span>
                </div>
                {state.closed.map((p) => {
                  const mk = market(p.marketId);
                  const basis = m.basisOf(p);
                  const realized = m.realizedOf(p);
                  return (
                    <div
                      className={styles.row}
                      data-variant="closed"
                      key={p.id}
                    >
                      <Link
                        href={`/market/${mk.id}`}
                        className={styles.rowTitle}
                      >
                        <b>{mk.title}</b>
                        <span>
                          <span className="venue">{venueName(mk.venueId)}</span>{" "}
                          · fees {usd(p.feeCents + p.exitFeeCents)}
                        </span>
                      </Link>
                      <span
                        className={`${styles.side} ${p.outcome === "Yes" ? styles.yes : styles.no}`}
                      >
                        {p.outcome}
                      </span>
                      <span className={styles.num}>
                        {p.shares.toLocaleString()}
                      </span>
                      <span className={styles.num}>
                        {cents(averageEntry(p))} →{" "}
                        {cents(p.proceedsCents / p.shares)}
                      </span>
                      <span className={styles.num}>{usd(basis)}</span>
                      <span className={styles.pnl}>
                        <Money value={realized} bold />
                        <span
                          className={realized >= 0 ? styles.up : styles.down}
                        >
                          {pct(realized, basis)}
                        </span>
                      </span>
                      <span className={styles.closedAt}>
                        {stamp(p.closedAt)}
                      </span>
                    </div>
                  );
                })}
                <div className={styles.total}>
                  <span>Realized P&amp;L · {state.closed.length} closed</span>
                  <span>
                    <Money value={m.totals.realizedCents} />
                  </span>
                </div>
              </>
            ) : (
              <Empty
                title="No closed positions yet"
                description="Sold and settled positions appear here, gains and losses both."
              />
            ))}
        </div>

        {/* It scrolls on its own: focusable, so the keyboard can scroll it. */}
        <aside className={styles.aside} aria-label="Activity" tabIndex={0}>
          <div className={styles.asideHead}>
            <History size={14} />
            <b>Activity</b>
            <span className={styles.spacer} />
            <span className={styles.export}>Export CSV</span>
          </div>
          <ActivityList activity={state.activity} />
        </aside>
      </div>
    </div>
  );
}

function ActivityList({ activity }: { activity: Activity[] }) {
  if (!activity.length)
    return (
      <p className={styles.noActivity}>
        Trades and claims will appear in this log.
      </p>
    );
  return (
    <>
      {activity.map((a) => (
        <div className={styles.activity} key={a.id}>
          <span className={styles.activityIcon}>{activityIcon(a)}</span>
          <span className={styles.activityBody}>
            <b>{a.title}</b>
            <span>{a.detail}</span>
          </span>
          <span className={styles.activityAmount}>
            <b className={a.amountCents < 0 ? styles.down : undefined}>
              {a.amountCents ? signedUsd(a.amountCents) : usd(0)}
            </b>
            <span>{stamp(a.at)}</span>
          </span>
        </div>
      ))}
    </>
  );
}

function OrderRow({
  order,
  title,
  marketId,
  onAction,
}: {
  order: Order;
  title: string;
  marketId: string;
  onAction: () => void;
}) {
  const q = order.quote;
  const failed = order.status === "failed";
  const action = orderAction(order);
  return (
    <div className={styles.orderRow}>
      <span className={styles.rowTitle}>
        <b>{title}</b>
        <span>{orderStamp(order.at)}</span>
      </span>
      <span>
        {q.side} {q.outcome}
      </span>
      <span>{failed ? "Market" : `Limit ${centsText(order.limitCents ?? q.priceCents)}`}</span>
      <span className={styles.fill}>
        {order.filledShares} / {q.shares}
      </span>
      <span
        className={`tag ${
          failed
            ? "tag-outline"
            : order.status === "partial"
              ? "tag-accent"
              : "tag-neutral"
        }`}
      >
        {orderStatus(order)}
      </span>
      <span className={styles.orderActions}>
        {failed ? (
          // A market order that found no liquidity cannot be re-run from a
          // log; retrying means a fresh ticket at the current price.
          <Link
            className={styles.ghost}
            href={`/market/${marketId}?side=${q.side}&outcome=${q.outcome}&trade=1`}
          >
            {action}
          </Link>
        ) : (
          <button className={styles.ghost} onClick={onAction}>
            {action}
          </button>
        )}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------- 11.2 phone */
const PHONE_TABS = [
  ["Open positions", "Open"],
  ["Pending orders", "Orders"],
  ["Closed", "Closed"],
  ["Activity", "Activity"],
] as const;

function Phone({ m }: { m: Model }) {
  const { state, market } = m;
  const tab = PHONE_TABS.some(([key]) => key === m.tab)
    ? m.tab
    : "Open positions";
  const count = (key: string) =>
    key === "Open positions"
      ? m.open.length
      : key === "Pending orders"
        ? m.liveOrders.length
        : key === "Closed"
          ? state.closed.length
          : null;
  return (
    <div className={styles.phone}>
      <h1 className="sr-only">Your portfolio.</h1>
      <section className={styles.phoneValue} aria-label="Account value">
        <div className={styles.phoneValueHead}>
          <span className={styles.statKey}>Account value</span>
          <span className={`tag tag-accent ${styles.demoTag}`}>
            Paper · simulated
          </span>
        </div>
        <b className={styles.phoneTotal}>{usd(m.totals.totalCents)}</b>
        <span className={styles.phoneAllTime}>
          <Money value={m.allTime} /> · {pct(m.allTime, m.startCents, 2)} all
          time
        </span>
        <dl className={styles.phoneTrio}>
          <div>
            <dt>Available</dt>
            <dd>{usd(m.available)}</dd>
          </div>
          <div>
            <dt>Positions</dt>
            <dd>{usd(m.openValue)}</dd>
          </div>
          <div>
            <dt>Unrealized</dt>
            <dd>
              <Money value={m.openValue - m.openBasis} />
            </dd>
          </div>
        </dl>
      </section>
      <Notice m={m} />
      {m.claimable.map((p) => {
        const mk = market(p.marketId);
        const payout = m.payoutOf(p);
        return (
          <Link
            key={p.id}
            href={`/position/${p.id}`}
            className={styles.phoneClaim}
          >
            <Flag size={18} />
            <span>
              <b>{usd(payout)} ready to claim</b>
              <span>
                {mk.shortTitle} resolved {mk.resolution.outcome} · profit{" "}
                {signedUsd(payout - m.basisOf(p))}
              </span>
            </span>
            <CaretRight size={16} />
          </Link>
        );
      })}
      <div className={styles.phoneTabs} data-indicator="line" role="group" aria-label="Show">
        {PHONE_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => m.setParam("tab", key)}
          >
            {label}
            {count(key) !== null && (
              <span className={styles.phoneCount}>{count(key)}</span>
            )}
          </button>
        ))}
      </div>
      <div className={styles.phoneList}>
        {tab === "Open positions" &&
          (m.open.length ? (
            m.open.map((p) => {
              const mk = market(p.marketId);
              const pnl = m.valueOf(p) - m.basisOf(p);
              return (
                <Link
                  key={p.id}
                  href={`/position/${p.id}`}
                  className={styles.phoneRow}
                >
                  <b className={styles.phoneTitle}>{mk.shortTitle}</b>
                  <b className={styles.phoneValueCell}>{usd(m.valueOf(p))}</b>
                  <span className={styles.phoneMeta}>
                    <span
                      className={`${styles.side} ${p.outcome === "Yes" ? styles.yes : styles.no}`}
                    >
                      {p.outcome}
                    </span>
                    {p.shares.toLocaleString()} @ {averageEntry(p).toFixed(0)}¢
                    · bid {bestBid(mk, p.outcome)}¢
                  </span>
                  <span className={styles.phonePnl}>
                    <Money value={pnl} />
                  </span>
                </Link>
              );
            })
          ) : (
            <p className={styles.phoneEmpty}>
              No open positions. Pick a market, buy Yes or No, and it shows up
              here.
            </p>
          ))}
        {tab === "Pending orders" &&
          (m.liveOrders.length ? (
            <>
              <p className={styles.phoneSection}>
                {usd(m.reserved)} reserved from cash
              </p>
              {m.liveOrders.map((o) => {
                const q = o.quote;
                const failed = o.status === "failed";
                return (
                  <div key={o.id} className={styles.phoneOrder}>
                    <b className={styles.phoneTitle}>
                      {market(q.marketId).shortTitle}
                    </b>
                    <span
                      className={`tag ${
                        failed
                          ? "tag-outline"
                          : o.status === "partial"
                            ? "tag-accent"
                            : "tag-neutral"
                      }`}
                    >
                      {orderStatus(o)}
                    </span>
                    <span className={styles.phoneMeta}>
                      {q.side} {q.outcome} ·{" "}
                      {failed ? "market" : `limit ${centsText(o.limitCents ?? q.priceCents)}`} ·{" "}
                      {o.filledShares} / {q.shares} filled
                    </span>
                    {failed ? (
                      <Link
                        className={styles.ghost}
                        href={`/market/${q.marketId}?side=${q.side}&outcome=${q.outcome}&trade=1`}
                      >
                        Retry
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => m.cancel(o)}
                      >
                        {orderAction(o)}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <p className={styles.phoneEmpty}>No orders waiting.</p>
          ))}
        {tab === "Closed" &&
          (state.closed.length ? (
            <>
              {state.closed.map((p) => {
                const realized = m.realizedOf(p);
                return (
                  <Link
                    key={p.id}
                    href={`/market/${p.marketId}`}
                    className={styles.phoneRow}
                  >
                    <b className={styles.phoneTitle}>
                      {market(p.marketId).shortTitle}
                    </b>
                    <span className={styles.phoneValueCell}>
                      <Money value={realized} bold />
                    </span>
                    <span className={styles.phoneMeta}>
                      {p.shares.toLocaleString()} {p.outcome} · in{" "}
                      {cents(averageEntry(p))} → out{" "}
                      {cents(p.proceedsCents / p.shares)} · {stamp(p.closedAt)}
                    </span>
                    <span className={styles.phoneRealized}>realized</span>
                  </Link>
                );
              })}
              <div className={styles.phoneTotal2}>
                <span>Realized P&amp;L</span>
                <Money value={m.totals.realizedCents} bold />
              </div>
            </>
          ) : (
            <p className={styles.phoneEmpty}>
              Sold and settled positions appear here.
            </p>
          ))}
        {tab === "Activity" && <ActivityList activity={state.activity} />}
      </div>
    </div>
  );
}
