"use client";
/* 12 · Position detail. 12.1: the position's numbers, its price since
   entry, its fills and both settlements, with a sell panel beside them.
   12.2: on a phone, the numbers and history, with Buy more and Sell at
   the thumb. 12.3 – 12.7: a resolved position and its claim. */
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CaretLeft,
  CheckCircle,
  Flag,
  Info,
  Spinner,
  CircleX,
} from "@/components/icons";
import { useDemo, useLive, useLoadingView } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import { priceFor, signedUsd, usd, venueFeeFor, tone } from "@imo/domain/money";
import { bestBid } from "@imo/domain/engine";
import type { Fill, Market, Position } from "@imo/domain/types";
import { venueName } from "@/data/venues";
import { SignInWall, Empty, timeLabel } from "@/components/ui";
import { dataNow } from "@/data/clock";
import { useMediaQuery } from "@/components/use-media-query";
import { TradeSheet, TradeTicket } from "./trade";
import styles from "./position.module.css";

/** "Sep 18 · 10:14", in UTC like the rest of the demo. */
const fillTime = (iso: string) =>
  `${timeLabel(iso)} · ${new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  })}`;

/** A fill's fee, split the way the ticket shows it: the venue's, then
    Hunch's 0.5%. */
const splitFee = (market: Market, fill: Fill) => {
  const venue = Math.min(
    fill.feeCents,
    venueFeeFor(market, fill.shares, fill.priceCents),
  );
  return { venue, app: fill.feeCents - venue };
};

/** What the resolution source said, then the source itself. */
const resolutionNote = (market: Market) => {
  const said = market.resolution.rule
    .replace(/^Resolved (Yes|No)\.\s*/, "")
    .split(/(?<=\.)\s/)[0];
  return market.resolution.source.trim() ? `${said} Source: ${market.resolution.source}.` : said;
};

type Receipt = {
  title: string;
  payoutCents: number;
  profitCents: number;
  cashCents: number;
};

/** The position's page while it loads, in its own columns. */
function PositionLoading({ phone }: { phone: boolean }) {
  const stats = [0, 1, 2, 3, 4, 5, 6, 7];
  if (phone)
    return (
      <Loading label="Loading this position" className={styles.phone}>
        <PhoneHead title="Position" />
        <div className={styles.phoneScroll}>
          <div className={styles.phoneTitle}>
            <div className={styles.pills}>
              <Bone w={36} h={20} r={6} />
              <Bone w={52} h={20} r={6} />
              <Bone w={44} h={20} r={6} />
            </div>
            <BoneLines lines={2} h={18} gap={10} last="62%" />
          </div>
          <dl className={styles.phoneStats}>
            {stats.slice(0, 6).map((i) => (
              <div key={i}>
                <Bone w={64} h={9} />
                <Bone w={i % 2 ? 56 : 78} h={16} style={{ marginTop: 8 }} />
              </div>
            ))}
          </dl>
          <section className={styles.phoneHistory}>
            <h2>History</h2>
            <BoneLines lines={2} h={11} gap={14} last="80%" />
          </section>
        </div>
        <div className={styles.phoneBar}>
          <Bone w="100%" h={44} r="pill" />
          <Bone w="100%" h={44} r="pill" />
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading this position" className={styles.page}>
      <div className={styles.main}>
        <div className={styles.heading}>
          <div className={styles.crumbs}>
            <span>Portfolio</span>
            <span aria-hidden="true">/</span>
            <span>Position</span>
            <Bone w={36} h={20} r={6} />
            <Bone w={52} h={20} r={6} />
            <span className={styles.flex} />
            <Bone w={124} h={34} r="pill" />
          </div>
          <Bone w="64%" h={28} style={{ marginTop: 6 }} />
        </div>
        <div className={styles.stats}>
          {stats.map((i) => (
            <div key={i}>
              <Bone w={70} h={9} />
              <Bone w={i % 3 ? 74 : 96} h={20} style={{ margin: "8px 0 6px" }} />
              <Bone w={88} h={9} />
            </div>
          ))}
        </div>
        <section className={styles.chartPanel}>
          <div className={styles.chartHead}>
            <h2>Price since entry</h2>
            <Bone w={110} h={10} />
            <Bone w={70} h={10} />
          </div>
          <Bone w="100%" h={150} r={8} />
        </section>
        <div className={styles.lower}>
          <section className={styles.history}>
            <h2>Trade history</h2>
            <BoneLines lines={3} h={11} gap={18} last="100%" />
          </section>
          <section className={styles.settlement}>
            <h2>At settlement</h2>
            <div className={styles.scenarios}>
              {[0, 1].map((i) => (
                <div key={i}>
                  <Bone w={48} h={11} />
                  <Bone w={80} h={20} style={{ marginTop: 10 }} />
                  <Bone w={64} h={14} style={{ marginTop: 10 }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <aside className={styles.aside}>
        <div className={styles.tabs} aria-hidden="true">
          <Bone w={70} h={12} style={{ margin: "16px auto" }} />
          <Bone w={40} h={12} style={{ margin: "16px auto" }} />
        </div>
        <div className={styles.ticketLoading}>
          <Bone w={150} h={30} r="pill" />
          <Bone w="100%" h={56} r={12} />
          <div className={styles.ticketChips}>
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} w="100%" h={32} r="pill" />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={styles.ticketRow}>
              <Bone w={i % 2 ? 96 : 120} h={10} />
              <Bone w={52} h={10} />
            </span>
          ))}
          <Bone w="100%" h={48} r="pill" />
        </div>
      </aside>
    </Loading>
  );
}

export function PositionDetail({ id }: { id: string }) {
  const { state } = useDemo();
  if (state.signedOut)
    return <SignInWall title="Positions are yours" description="Log in to see your positions and what they’re worth." />;
  return <PositionDetailPage id={id} />;
}

function PositionDetailPage({ id }: { id: string }) {
  const { state, services } = useDemo();
  const phone = useMediaQuery("(max-width: 600px)");
  const loading = useLoadingView();
  // Claiming removes the position, so the receipt is kept to survive it.
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const position = state.positions.find((p) => p.id === id);
  const market = position ? services.markets.get(position.marketId) : undefined;
  useLive("market", position?.marketId);
  if (loading || (!!position && !market && services.pending("market", position.marketId)))
    return <PositionLoading phone={phone} />;
  if (!position || !market)
    return receipt ? (
      <div className={styles.receiptPage}>
        {phone && <PhoneHead title="Resolved position" />}
        <ClaimCard state="claimed" receipt={receipt} />
      </div>
    ) : (
      <Empty
        title="This position isn’t open"
        description="It may have been sold, claimed or reset. Your portfolio has the current picture."
        action={
          <Link href="/portfolio" className="btn btn-primary">
            Back to portfolio
          </Link>
        }
      />
    );
  // The claim row the server settled this position into, if any yet.
  const settled = state.claimable.find((c) => c.positionId === position.id);
  const claim = async () => setReceipt(await services.portfolio.claim(position.id));
  if (market.status === "resolved")
    return (
      <Resolved
        position={position}
        market={market}
        phone={phone}
        payoutCents={settled?.payoutCents ?? null}
        onClaim={claim}
      />
    );
  return phone ? (
    <Phone position={position} market={market} />
  ) : (
    <Desktop position={position} market={market} />
  );
}

/** The figures both layouts show. */
function figuresOf(position: Position, market: Market) {
  const last = priceFor(market, position.outcome);
  const bid = bestBid(market, position.outcome);
  const basis = position.costCents + position.feeCents;
  const avgEntry = position.costCents / position.shares;
  const value = position.shares * bid;
  const unrealized = value - basis;
  const fees = position.fills.length
    ? position.fills.reduce(
        (s, f) => {
          const split = splitFee(market, f);
          return { venue: s.venue + split.venue, app: s.app + split.app };
        },
        { venue: 0, app: 0 },
      )
    : splitFee(market, {
        id: "",
        at: "",
        side: "Buy",
        shares: position.shares,
        priceCents: Math.round(avgEntry),
        feeCents: position.feeCents,
      });
  const stats: { label: string; value: string; note: string; tone?: string }[] =
    [
      {
        label: "Shares",
        value: `${position.shares.toLocaleString()} ${position.outcome}`,
        note: `${venueName(market.venueId)} ${market.venueContractId}`,
      },
      {
        label: "Avg entry",
        value: `${avgEntry.toFixed(1)}¢`,
        note: "excl. fees",
      },
      {
        label: "Cost basis",
        value: usd(basis),
        note: `${usd(position.costCents)} notional + ${usd(position.feeCents)} fees`,
      },
      {
        label: "Fees paid",
        value: usd(position.feeCents),
        note: `${venueName(market.venueId)} ${usd(fees.venue)} · imo ${usd(fees.app)}`,
      },
      { label: "Current price", value: `${last}¢`, note: "last trade" },
      {
        label: "Executable bid",
        value: `${bid}¢`,
        note: "what you’d sell at now",
      },
      {
        label: "Current value",
        value: usd(value),
        note: `${position.shares.toLocaleString()} × ${bid}¢`,
      },
      {
        label: "Unrealized P&L",
        value: `${unrealized >= 0 ? "▲" : "▼"} ${signedUsd(unrealized)}`,
        note: `${unrealized >= 0 ? "+" : "−"}${Math.abs((unrealized / basis) * 100).toFixed(1)}% vs cost basis`,
        tone: tone(unrealized),
      },
    ];
  const status =
    market.status === "closed"
      ? "Closed · awaiting result"
      : `Open · closes ${timeLabel(market.closesAt)}`;
  return { last, bid, basis, avgEntry, value, unrealized, stats, status };
}

/** The held side's price since the first fill: the venue's history, your
    average entry across it, and each fill where and when it happened. */
function EntryChart({ position, market, avgEntry }: { position: Position; market: Market; avgEntry: number }) {
  const { services } = useDemo();
  const sample = !!services.config()?.dataSnapshot;
  const first = Math.min(...position.fills.map((fill) => Date.parse(fill.at)));
  const days = (dataNow() - first) / 86_400_000;
  const range = days <= 1 ? "1D" : days <= 7 ? "1W" : days <= 30 ? "1M" : "All";
  const history = sample ? undefined : services.markets.history(market.id, range);
  const side = (yes: number) => (position.outcome === "Yes" ? yes : 100 - yes);
  // The design's sample world has no history: its sparkline stands in, with
  // the fills spread across it.
  const points: { at: number; v: number }[] = sample
    ? market.series.map((v, i) => ({ at: i, v: side(v) }))
    : [
        ...(history ?? []).filter((p) => p.at >= first - 3_600_000).map((p) => ({ at: p.at, v: side(p.yes) })),
        { at: dataNow(), v: priceFor(market, position.outcome) },
      ];
  if (!sample && !history)
    return (
      <div className={styles.chart} role="status">
        <p className={styles.chartNote}>
          {history === null ? "Price history isn’t available right now." : "Loading price history…"}
        </p>
      </div>
    );
  const t0 = sample ? 0 : Math.min(first, points[0]?.at ?? first);
  const t1 = sample ? Math.max(1, points.length - 1) : Math.max(t0 + 1, dataNow());
  const x = (at: number) => ((at - t0) / (t1 - t0)) * 100;
  const values = [...points.map((p) => p.v), ...position.fills.map((fill) => fill.priceCents), avgEntry];
  const low = Math.min(...values) - 5;
  const high = Math.max(...values) + 5;
  const plot = (cents: number) => Math.min(97, Math.max(3, ((cents - low) / (high - low)) * 100));
  const fillAt = (fill: Fill, i: number) =>
    sample ? ((i + 1) / (position.fills.length + 1)) * 100 : x(Date.parse(fill.at));
  return (
    <div className={styles.chart}>
      <svg className="sparkline draw" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          points={points.map((p) => `${x(p.at).toFixed(2)},${(100 - plot(p.v)).toFixed(2)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className={styles.entryLine} style={{ bottom: `${plot(avgEntry)}%` }} aria-hidden="true" />
      {position.fills.map((fill, i) => (
        <span
          key={fill.id}
          className={styles.fillMark}
          style={{ left: `${Math.min(100, Math.max(0, fillAt(fill, i)))}%`, bottom: `${plot(fill.priceCents)}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------- 12.1 desktop */
function Desktop({ position, market }: { position: Position; market: Market }) {
  const [tab, setTab] = useState<"Sell" | "Buy more">("Sell");
  const f = figuresOf(position, market);
  const payoutIfRight = position.shares * 100;
  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.heading}>
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            <Link href="/portfolio">Portfolio</Link>
            <span aria-hidden="true">/</span>
            <span>Position</span>
            <span className={styles.sidePill}>{position.outcome}</span>
            <span className="tag tag-neutral">{venueName(market.venueId)}</span>
            <span className="tag tag-outline">{f.status}</span>
            <span className={styles.flex} />
            <Link href={`/market/${market.id}`} className="btn btn-secondary">
              Open market
              <ArrowUpRight size={13} />
            </Link>
          </nav>
          <h1>{market.title}</h1>
        </header>
        <div className={styles.stats}>
          {f.stats.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <b className={s.tone}>{s.value}</b>
              <small>{s.note}</small>
            </div>
          ))}
        </div>
        <section className={styles.chartPanel}>
          <div className={styles.chartHead}>
            <h2>Price since entry</h2>
            <span className={styles.legendEntry}>
              <i /> Your avg {f.avgEntry.toFixed(1)}¢
            </span>
            <span className={styles.legendFill}>
              <i /> Your fills
            </span>
          </div>
          <EntryChart position={position} market={market} avgEntry={f.avgEntry} />
        </section>
        <div className={styles.lower}>
          <section className={styles.history}>
            <h2 id="trade-history-heading">Trade history</h2>
            <div
              className={styles.tableScroll}
              tabIndex={0}
              role="region"
              aria-labelledby="trade-history-heading"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Action</th>
                    <th scope="col" className={styles.num}>
                      Shares
                    </th>
                    <th scope="col" className={styles.num}>
                      Price
                    </th>
                    <th scope="col" className={styles.num}>
                      Venue fee
                    </th>
                    <th scope="col" className={styles.num}>
                      App fee
                    </th>
                    <th scope="col" className={styles.num}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {position.fills.map((fill) => {
                    const fee = splitFee(market, fill);
                    return (
                      <tr key={fill.id}>
                        <td>{fillTime(fill.at)}</td>
                        <td>
                          {fill.side} {position.outcome}
                        </td>
                        <td className={styles.num}>
                          {fill.shares.toLocaleString()}
                        </td>
                        <td className={styles.num}>{fill.priceCents}¢</td>
                        <td className={styles.num}>{usd(fee.venue)}</td>
                        <td className={styles.num}>{usd(fee.app)}</td>
                        <td className={styles.num}>
                          {usd(fill.shares * fill.priceCents + fill.feeCents)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className={styles.total}>
                    <td>Total</td>
                    <td />
                    <td className={styles.num}>
                      {position.shares.toLocaleString()}
                    </td>
                    <td className={styles.num}>{f.avgEntry.toFixed(1)}¢</td>
                    <td className={styles.num} colSpan={2}>
                      {usd(position.feeCents)}
                    </td>
                    <td className={styles.num}>{usd(f.basis)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!position.fills.length && (
              <p className={styles.note}>
                This position was seeded with the demo account, so no individual
                fills were recorded.
              </p>
            )}
          </section>
          <section className={styles.settlement}>
            <h2>At settlement</h2>
            <div className={styles.scenarios}>
              <div>
                <span>If {position.outcome}</span>
                <small>Payout</small>
                <b>{usd(payoutIfRight)}</b>
                <small>Profit after fees</small>
                <b className="positive">
                  ▲ {signedUsd(payoutIfRight - f.basis)}
                </b>
              </div>
              <div>
                <span>If {position.outcome === "Yes" ? "No" : "Yes"}</span>
                <small>Payout</small>
                <b>{usd(0)}</b>
                <small>Loss incl. fees</small>
                <b className="negative">▼ {signedUsd(-f.basis)}</b>
              </div>
            </div>
            <p className={styles.note}>
              You are <b>right</b> only if this resolves {position.outcome}. You
              can be <b>profitable</b> without being right by selling above your{" "}
              {f.avgEntry.toFixed(1)}¢ average first.
            </p>
          </section>
        </div>
      </div>
      <aside className={styles.aside}>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Trade this position"
        >
          {(["Buy more", "Sell"] as const).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <TradeTicket
          key={tab}
          market={market}
          initialOutcome={position.outcome}
          initialSide={tab === "Sell" ? "Sell" : "Buy"}
          sideToggle={false}
          outcomeToggle={false}
        />
        <p className={styles.fine}>
          <Info size={14} />
          Realized P&amp;L on a sale is after that sale’s fees. The{" "}
          {usd(position.feeCents)} paid on entry is already in your account’s
          fees total.
        </p>
      </aside>
    </div>
  );
}

function PhoneHead({ title, market }: { title: string; market?: Market }) {
  return (
    <header className={styles.phoneHead}>
      <Link
        href="/portfolio"
        className={`btn btn-icon ${styles.back}`}
        aria-label="Back to portfolio"
      >
        <CaretLeft size={20} />
      </Link>
      <b>{title}</b>
      {market && (
        <Link
          href={`/market/${market.id}`}
          className={`btn btn-ghost ${styles.headLink}`}
        >
          Market
        </Link>
      )}
    </header>
  );
}

/* ----------------------------------------------------------- 12.2 phone */
function Phone({ position, market }: { position: Position; market: Market }) {
  const f = figuresOf(position, market);
  const [sheet, setSheet] = useState<"Buy" | "Sell" | null>(null);
  const open = market.status === "open";
  return (
    <div className={styles.phone}>
      <PhoneHead title="Position" market={market} />
      <div className={styles.phoneScroll}>
        <div className={styles.phoneTitle}>
          <div className={styles.pills}>
            <span className={styles.sidePill}>{position.outcome}</span>
            <span className="tag tag-neutral">{venueName(market.venueId)}</span>
            <span className="tag tag-outline">
              {open ? "Open" : "Awaiting result"}
            </span>
          </div>
          <h1>{market.title}</h1>
        </div>
        <dl className={styles.phoneStats}>
          {f.stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd className={s.tone}>{s.value}</dd>
            </div>
          ))}
        </dl>
        <section className={styles.phoneHistory} aria-labelledby="history">
          <h2 id="history">History</h2>
          {position.fills.length ? (
            <ul>
              {position.fills.map((fill) => (
                <li key={fill.id}>
                  <span>
                    {timeLabel(fill.at)} · {fill.side}{" "}
                    {fill.shares.toLocaleString()} @ {fill.priceCents}¢
                  </span>
                  <span>
                    {usd(fill.shares * fill.priceCents + fill.feeCents)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>
              Seeded with the demo account, so no individual fills.
            </p>
          )}
        </section>
      </div>
      {open && (
        <div className={styles.phoneBar}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSheet("Buy")}
          >
            Buy more
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setSheet("Sell")}
          >
            <span>Sell · bid {f.bid}¢</span>
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <TradeSheet
        key={sheet ?? "closed"}
        market={market}
        open={sheet !== null}
        onOpenChange={(o) => !o && setSheet(null)}
        initialOutcome={position.outcome}
        initialSide={sheet ?? "Sell"}
      />
    </div>
  );
}

/* ------------------------------------------------- 12.3 – 12.7 · claim */
function Resolved({
  position,
  market,
  phone,
  payoutCents,
  onClaim,
}: {
  position: Position;
  market: Market;
  phone: boolean;
  /** What settlement booked for it; null while the market is still settling. */
  payoutCents: number | null;
  onClaim: () => Promise<void>;
}) {
  const [claiming, setClaiming] = useState(false);
  const [failed, setFailed] = useState("");
  const settling = payoutCents === null;
  const payout = payoutCents ?? 0;
  const perShare = position.shares ? payout / position.shares : 0;
  const won = payout - (position.costCents + position.feeCents) >= 0;
  const basis = position.costCents + position.feeCents;
  const avg = position.costCents / position.shares;
  const claim = () => {
    setClaiming(true);
    setFailed("");
    onClaim().catch((e: unknown) => {
      setFailed((e as Error).message);
      setClaiming(false);
    });
  };
  const breakdown = (
    <dl className={styles.breakdown}>
      <div>
        <dt>
          {position.shares.toLocaleString()} {position.outcome}
          {settling ? "" : ` × ${usd(perShare)}`}
        </dt>
        <dd>
          <b>{settling ? "Payout settling…" : `Payout ${usd(payout)}`}</b>
        </dd>
      </div>
      <div>
        <dt>Cost basis · avg {avg.toFixed(0)}¢</dt>
        <dd>{usd(basis)}</dd>
      </div>
      {!settling && (
        <div>
          <dt>{won ? "Profit (realized on claim)" : "Loss (realized)"}</dt>
          <dd className={won ? "positive" : "negative"}>
            <b>
              {won ? "▲" : "▼"} {signedUsd(payout - basis)}
            </b>
          </dd>
        </div>
      )}
      <div>
        <dt>Settlement fee</dt>
        <dd>{usd(0)}</dd>
      </div>
    </dl>
  );
  const status = settling ? "settling" : claiming ? "claiming" : failed ? "failed" : "claimable";
  const content = (
    <>
      <span className={styles.resolvedPill}>
        <Flag size={13} />
        Resolved {market.resolution.outcome ?? "void"} · {timeLabel(market.closesAt)}
      </span>
      <h1 className={styles.resolvedTitle}>{market.title}</h1>
      <p className={styles.resolvedNote}>{resolutionNote(market)}</p>
      {breakdown}
    </>
  );
  if (phone)
    return (
      <div className={styles.phone}>
        <PhoneHead title="Resolved position" />
        <div className={styles.claimPhone}>
          {content}
          <span className={styles.flex} />
          {failed && <ClaimCard state="failed" payoutCents={payout} />}
          <button
            type="button"
            className={`btn btn-primary btn-lg ${styles.claimCta}`}
            onClick={claim}
            disabled={claiming || settling || !payout}
            aria-busy={claiming || settling || undefined}
          >
            <span>
              {settling
                ? "Settling…"
                : claiming
                  ? "Claiming…"
                  : payout
                    ? `Claim ${usd(payout)} to cash`
                    : "Nothing to claim"}
            </span>
            {claiming ? (
              <Spinner size={16} className={styles.spin} />
            ) : (
              <ArrowRight size={16} />
            )}
          </button>
        </div>
      </div>
    );
  return (
    <div className={styles.resolvedPage}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/portfolio">Portfolio</Link>
        <span aria-hidden="true">/</span>
        <span>Resolved position</span>
      </nav>
      <div className={styles.resolvedGrid}>
        <div className={styles.resolvedMain}>{content}</div>
        <ClaimCard
          state={status}
          payoutCents={payout}
          profitCents={payout - basis}
          detail={`${market.shortTitle} resolved ${market.resolution.outcome ?? "void"}. ${position.shares.toLocaleString()} shares × ${usd(perShare)}.`}
          onClaim={payout ? claim : undefined}
        />
      </div>
    </div>
  );
}

/** 12.4 – 12.7 · where a claim stands, as one card. */
function ClaimCard({
  state,
  payoutCents = 0,
  profitCents = 0,
  detail,
  receipt,
  onClaim,
}: {
  state: "settling" | "claimable" | "claiming" | "claimed" | "failed";
  payoutCents?: number;
  profitCents?: number;
  detail?: string;
  receipt?: Receipt;
  onClaim?: () => void;
}) {
  const card = {
    claimable: {
      icon: <Flag size={18} />,
      title: `${usd(payoutCents)} ready to claim`,
      body: detail ?? "",
      k: "Profit on claim",
      v: signedUsd(profitCents),
    },
    settling: {
      icon: <Spinner size={18} className={styles.spin} />,
      title: "Settling…",
      body: "The market has resolved. imo books every holder’s result within a minute or so; your payout appears here.",
      k: "Status",
      v: "Settling",
    },
    claiming: {
      icon: <Spinner size={18} className={styles.spin} />,
      title: "Claiming…",
      body: "Moving your payout into cash.",
      k: "Status",
      v: "Pending",
    },
    claimed: {
      icon: <CheckCircle size={18} />,
      title: `${usd(receipt?.payoutCents ?? 0)} added to cash`,
      body: `Realized P&L ${signedUsd(receipt?.profitCents ?? 0)} booked. ${receipt?.title ?? "The position"} moved to Closed.`,
      k: "New cash balance",
      v: usd(receipt?.cashCents ?? 0),
    },
    failed: {
      icon: <CircleX size={18} />,
      title: "Claim didn’t go through",
      body: "Something went wrong on our side. Your payout is safe and still claimable.",
      k: "Still claimable",
      v: usd(payoutCents),
    },
  }[state];
  return (
    <section
      className={styles.claimCard}
      data-state={state}
      role={state === "claimed" || state === "failed" ? "status" : undefined}
      aria-live="polite"
    >
      <div className={styles.claimCardHead}>
        {card.icon}
        <h2>{card.title}</h2>
      </div>
      <p>{card.body}</p>
      <div className={styles.claimKv}>
        <span>{card.k}</span>
        <b>{card.v}</b>
      </div>
      {state === "claimable" && onClaim && (
        <button
          type="button"
          className="btn btn-primary btn-split"
          onClick={onClaim}
        >
          <span>Claim {usd(payoutCents)} to cash</span>
          <ArrowRight size={15} />
        </button>
      )}
      {state === "failed" && onClaim && (
        <button
          type="button"
          className="btn btn-secondary btn-split"
          onClick={onClaim}
        >
          <span>Retry claim</span>
          <ArrowRight size={15} />
        </button>
      )}
      {state === "claimed" && (
        <Link
          href="/portfolio?tab=Closed"
          className="btn btn-secondary btn-split"
        >
          <span>View closed positions</span>
          <ArrowRight size={15} />
        </Link>
      )}
    </section>
  );
}
