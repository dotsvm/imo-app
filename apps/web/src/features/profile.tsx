"use client";
/* 13 · A trader's profile. 13.1: who they are, what they've made and
   lost net of fees, how often they were right with the sample beside it,
   and every call; the record and the people column scroll on their own.
   13.2: your own profile on a phone. */
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  Bell,
  CaretLeft,
  Check,
  DotsThree,
  Export,
  EyeOff,
  GearSix,
  X,
} from "@/components/icons";
import { useDemo, useLive, useLoadingView, useSeason } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import { centsText, priceFor, signedUsd, usd, tone, signedPct } from "@imo/domain/money";
import {
  MIN_SAMPLE,
  accuracy,
  bestBid,
  portfolioTotals,
} from "@imo/domain/engine";
import type { Order, Outcome, Post, Trader } from "@imo/domain/types";
import { Avatar, Empty, FollowButton, timeLabel, meta } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { useMediaQuery } from "@/components/use-media-query";
import { PostCard } from "./social";
import { TraderPagination } from "./trader-pagination";
import { useListPagination } from "./use-list-pagination";
import styles from "./profile.module.css";
import { venueName } from "@/data/venues";
import { dataNow } from "@/data/clock";

const periods = ["7D", "30D", "90D", "All"] as const;
type Period = (typeof periods)[number];
/** The demo's snapshot day; charts end here. */
const DAYS: Record<Period, number> = { "7D": 7, "30D": 30, "90D": 90, All: 0 };
/** The people the design shows around a trader, in its order. */
const periodLabel = (p: Period) => (p === "All" ? "all time" : p.toLowerCase());
/** "−$2,140": whole dollars, as the design prints drawdowns. */
const whole = (cents: number) =>
  `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
/** "$82.2K" once a figure passes $10,000. */
const compactUsd = (cents: number) =>
  Math.abs(cents) < 1_000_000
    ? usd(Math.abs(cents))
    : `$${(Math.abs(cents) / 100_000).toFixed(1)}K`;
const compactSigned = (cents: number) =>
  Math.abs(cents) < 1_000_000
    ? signedUsd(cents)
    : `${cents < 0 ? "−" : "+"}${compactUsd(cents)}`;
const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** The period's cumulative P&L by day, as the server drew it from the
    account's daily equity; null until there's a line to draw. */
function curve(trader: Trader, period: Period) {
  const points = trader.curves?.[period] ?? (period === "30D" ? trader.curve30 : undefined);
  return points && points.length >= 2 ? points : null;
}

/** One line of a trader's record, as 13.1's table reads it. */
type Row = {
  key: string;
  title: string;
  href?: string;
  outcome: Outcome;
  when: string;
  result: string;
  right: boolean | null;
  trade: string;
  pnl: number;
};

/** Everything both layouts show about a trader. */
function useProfile(id: string) {
  const { services, state } = useDemo();
  const [period, setPeriod] = useState<Period>("30D");
  const trader = services.profiles.get(id);
  if (!trader) return null;
  const self = trader.id === "you";
  const stats = trader.stats[period];
  const rows: Row[] = trader.history
    .map((h, i) => {
      const market = services.markets.get(h.marketId);
      const result =
        h.archived?.result ??
        (market?.status === "resolved" ? market.resolution.outcome : undefined);
      const settle = result ? (result === h.outcome ? 100 : 0) : undefined;
      const exit =
        h.exitPrice ?? (market ? priceFor(market, h.outcome) : h.entryPrice);
      const sold = h.exitPrice !== undefined && h.exitPrice !== settle;
      const pnl = h.shares * (exit - h.entryPrice) - h.feeCents;
      const closedAt = h.archived?.closedAt ?? market?.closesAt ?? "";
      const right = result ? result === h.outcome : null;
      return {
        key: `${h.marketId}-${i}`,
        title: h.archived?.title ?? market?.title ?? h.marketId,
        href: market ? `/market/${market.id}` : undefined,
        outcome: h.outcome,
        when: result
          ? `${timeLabel(closedAt)} · ${sold ? `sold at ${h.exitPrice}¢ before result` : "held to settlement"}`
          : `${h.shares.toLocaleString("en-US")} @ ${h.entryPrice}¢ · ${sold ? `sold at ${h.exitPrice}¢` : "holding"}`,
        result: result ? `Resolved ${result}` : "Open",
        right,
        trade: result
          ? sold
            ? pnl >= 0
              ? "Sold early · profit"
              : "Sold early · loss"
            : right
              ? "Settled · won"
              : "Settled · lost"
          : sold
            ? pnl >= 0
              ? "Sold · profit"
              : "Sold · loss"
            : "Open · unrealized",
        pnl,
      };
    })
    // Resolved first; each group keeps the record's own order.
    .toSorted((a, b) => Number(a.right === null) - Number(b.right === null));
  // Yours come from your live positions; others' from their record.
  const open = self
    ? state.positions
        .map((p) => {
          const market = services.markets.get(p.marketId)!;
          const bid = bestBid(market, p.outcome);
          return {
            key: p.id,
            market,
            outcome: p.outcome,
            shares: p.shares,
            entryPrice: Math.round(p.costCents / p.shares),
            now: bid,
            pnl: p.shares * bid - p.costCents - p.feeCents,
          };
        })
        .filter((h) => h.market.status !== "resolved")
    : trader.history
        .filter((h) => h.exitPrice === undefined && !h.archived)
        .map((h, i) => {
          const market = services.markets.get(h.marketId)!;
          const now = priceFor(market, h.outcome);
          return {
            key: `${h.marketId}-${i}`,
            market,
            outcome: h.outcome,
            shares: h.shares,
            entryPrice: h.entryPrice,
            now,
            pnl: h.shares * (now - h.entryPrice) - h.feeCents,
          };
        })
        .filter((h) => h.market.status !== "resolved");
  // Predictions and trades you placed from someone's Back / Fade drawer.
  const backed = self
    ? state.orders
        .filter((o) => o.postId && o.filledShares > 0)
        .map((o) => ({
          order: o,
          post: state.posts.find((p) => p.id === o.postId),
        }))
        .filter((b): b is { order: Order; post: Post } => !!b.post)
    : [];
  const following = state.following.includes(id);
  const all = services.profiles.list();
  const get = (tid: string) => all.find((t) => t.id === tid);
  return {
    trader,
    self,
    period,
    setPeriod,
    stats,
    lowSample: stats.resolved < MIN_SAMPLE,
    rank: self ? null : (trader.rank30 ?? null),
    following,
    notify: state.notifyTraders.includes(id),
    toggleNotify: () => services.profiles.toggleNotify(id),
    totals: portfolioTotals(state, services.markets.list()),
    posts: state.posts.filter((p) => p.authorId === id),
    rooms: state.rooms.filter((r) => r.members.includes(id) || trader.roomIds?.includes(r.id)),
    rows,
    predictions: self ? rows.length : trader.record.predictions,
    open,
    hidePositions: trader.privatePositions && !self,
    backed,
    market: (mid: string) => services.markets.get(mid)!,
    author: get,
    // The people around them: those who follow (you first, if you do)…
    followers: [
      ...(following && !self ? [services.profiles.get("you")!] : []),
      ...(services.profiles.followers(id) ?? []).filter((t) => t.id !== "you" || !following),
    ],
    // …and those they follow.
    followingList: self
      ? state.following.map((k) => services.profiles.get(k)).filter((t): t is Trader => !!t)
      : (services.profiles.followingOf(id) ?? []),
  };
}

type Model = NonNullable<ReturnType<typeof useProfile>>;

export function Profile({ id }: { id: string }) {
  const phone = useMediaQuery("(max-width: 600px)");
  useLive("trader", id);
  const loading = useLoadingView();
  const model = useProfile(id);
  // Until their record arrives: the page's shape, never a row of zeros.
  if (loading || model?.trader.pending) return phone ? <PhoneLoading /> : <DesktopLoading />;
  if (!model)
    return (
      <Empty
        title="No trader goes by that handle"
        description="Discover other perspectives in the feed."
        action={
          <Link href="/feed" className="btn btn-primary">
            Explore feed
          </Link>
        }
      />
    );
  return phone ? <Phone m={model} /> : <Desktop m={model} />;
}

const LOADING_ROWS = [72, 58, 66, 50, 62];
const LOADING_PEOPLE = [96, 82, 110, 74, 90, 86];

function DesktopLoading() {
  return (
    <Loading label="Loading this profile" className={styles.page}>
      <div className={styles.main}>
        <header className={styles.identity}>
          <Bone circle={84} />
          <div>
            <div className={styles.nameRow}>
              <Bone w={210} h={26} />
              <Bone w={92} h={20} r="pill" />
            </div>
            <Bone w={190} h={11} style={{ margin: "10px 0 12px" }} />
            <BoneLines lines={2} h={11} last="45%" />
            <div className={styles.counts}>
              <Bone w={96} h={12} />
              <Bone w={96} h={12} />
              <Bone w={60} h={12} />
            </div>
          </div>
          <div className={styles.identityActions}>
            <Bone w={104} h={36} r="pill" />
            <Bone circle={36} />
          </div>
        </header>
        <div className={styles.stats}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <Bone w={64} h={9} />
              <Bone w={i % 2 ? 72 : 96} h={20} style={{ margin: "8px 0 6px" }} />
              <Bone w={82} h={9} />
            </div>
          ))}
        </div>
        <section className={styles.chartPanel}>
          <div className={styles.chartHead}>
            <h2>Cumulative P&amp;L · net of fees</h2>
            <Bone w={176} h={30} r="pill" />
          </div>
          <Bone w="100%" h={140} r={8} />
          <div className={styles.chartFoot}>
            <Bone w={52} h={9} />
            <Bone w={150} h={9} />
            <Bone w={52} h={9} />
          </div>
        </section>
        <div className={styles.tabs} aria-hidden="true">
          {[118, 112, 72].map((w) => (
            <Bone key={w} w={w} h={12} style={{ margin: "15px 12px" }} />
          ))}
        </div>
        <div className={styles.historyHead}>
          <span>Prediction</span>
          <span>Call</span>
          <span>Result</span>
          <span>Called it?</span>
          <span>Trade outcome</span>
          <span className={styles.num}>P&amp;L</span>
        </div>
        {LOADING_ROWS.map((w, i) => (
          <div className={styles.historyRow} key={i}>
            <span className={styles.prediction}>
              <Bone w={`${w}%`} h={12} />
              <Bone w={120} h={9} style={{ marginTop: 6 }} />
            </span>
            <Bone w={34} h={18} r={5} />
            <Bone w={84} h={11} />
            <Bone w={52} h={11} />
            <Bone w={84} h={11} />
            <Bone w={60} h={12} className={styles.num} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
      <aside className={styles.aside}>
        <section className={styles.context}>
          <h2>Performance context</h2>
          <div className={styles.contextGrid}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Bone w={104} h={9} />
                <Bone w={i % 2 ? 64 : 88} h={18} style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>
          <BoneLines lines={2} h={9} last="55%" />
        </section>
        <div className={styles.followTabs} aria-hidden="true">
          {[68, 70].map((w) => (
            <Bone key={w} w={w} h={12} style={{ margin: "15px 10px" }} />
          ))}
        </div>
        {LOADING_PEOPLE.map((w, i) => (
          <div className={styles.peer} key={i}>
            <Bone circle={34} />
            <span className={styles.peerName} style={{ gap: 6 }}>
              <Bone w={w} h={12} />
              <Bone w={w + 30} h={9} />
            </span>
            <Bone w={66} h={26} r="pill" />
          </div>
        ))}
      </aside>
    </Loading>
  );
}

function PhoneLoading() {
  return (
    <Loading label="Loading this profile" className={styles.phone}>
      <header className={styles.phoneTop}>
        <Bone circle={36} />
        <span className={styles.flex} />
        <Bone circle={36} />
      </header>
      <section className={styles.phoneId}>
        <Bone circle={64} />
        <div className={styles.phoneName}>
          <Bone w={170} h={22} />
        </div>
        <Bone w="78%" h={11} style={{ margin: "4px 0" }} />
        <div className={styles.phoneActions}>
          <Bone w={110} h={36} r="pill" />
          <Bone w={90} h={36} r="pill" />
        </div>
      </section>
      <dl className={styles.phoneStats}>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Bone w={68} h={9} />
            <Bone w={i === 1 ? 70 : 84} h={16} style={{ marginTop: 8 }} />
          </div>
        ))}
      </dl>
      <div className={styles.phoneTabs} aria-hidden="true">
        {[84, 72, 60].map((w) => (
          <Bone key={w} w={w} h={12} style={{ margin: "16px 10px" }} />
        ))}
      </div>
      <div className={styles.phoneList}>
        {LOADING_ROWS.map((w, i) => (
          <div className={styles.phoneRow} key={i}>
            <Bone w={`${w + 10}%`} h={12} className={styles.phoneTitle} />
            <Bone w={58} h={12} />
            <Bone w={120} h={9} className={styles.phoneSub} />
            <Bone w={48} h={9} />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** The bell: be told when this trader posts a prediction. */
function NotifyButton({ m }: { m: Model }) {
  const first = m.trader.name.split(" ")[0];
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-icon ${styles.round}`}
      aria-pressed={m.notify}
      aria-label={
        m.notify
          ? `Notifications on for ${first}’s predictions`
          : `Notify me when ${first} posts`
      }
      title={m.notify ? "Notifications on" : `Notify me when ${first} posts`}
      data-on={m.notify || undefined}
      onClick={m.toggleNotify}
    >
      <Bell size={16} />
    </button>
  );
}

/** Copy the profile's link, or hand it to the system sheet on a phone. */
async function shareProfile(trader: Trader) {
  const url = `${window.location.origin}/trader/${trader.id}`;
  try {
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches)
      await navigator.share({ title: `${trader.name} on imo`, url });
    else await navigator.clipboard.writeText(url);
  } catch {
    // Dismissed or blocked: the address bar still has it.
  }
}

function MoreMenu({ m, quiet = false }: { m: Model; quiet?: boolean }) {
  return (
    <Menu
      label={`More about ${m.trader.name}`}
      triggerClassName={
        quiet
          ? `btn btn-ghost btn-icon ${styles.phoneIcon}`
          : `btn btn-secondary btn-icon ${styles.round}`
      }
      trigger={<DotsThree size={18} />}
    >
      <MenuItem
        icon={<Export size={15} />}
        onSelect={() => shareProfile(m.trader)}
      >
        Copy link to profile
      </MenuItem>
      <MenuItem href="/leaderboard" icon={<ArrowUpRight size={15} />}>
        See the leaderboard
      </MenuItem>
    </Menu>
  );
}

/* --------------------------------------------------------- 13.1 desktop */
function Desktop({ m }: { m: Model }) {
  const { trader, self, period, stats } = m;
  const [tab, setTab] = useState("Predictions");
  const [followTab, setFollowTab] = useState<"Followers" | "Following">(
    "Followers",
  );
  const allTime = trader.stats.All;
  const points = curve(trader, period);
  const min = Math.min(0, ...(points ?? []));
  const max = Math.max(1, ...(points ?? []));
  const path = points
    ?.map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / (points.length - 1)) * 900).toFixed(1)} ${(
          140 -
          ((v - min) / (max - min)) * 136
        ).toFixed(1)}`,
    )
    .join(" ");
  const headline: {
    label: string;
    value: string;
    note: string;
    tone?: string;
  }[] = self
    ? [
        {
          label: "Account value",
          value: usd(m.totals.totalCents),
          note: "cash + positions at the bid",
        },
        {
          label: "Unrealized P&L",
          value: signedUsd(m.totals.unrealizedCents),
          note: "open positions vs cost",
          tone: tone(m.totals.unrealizedCents),
        },
        {
          label: "Realized P&L",
          value: signedUsd(m.totals.realizedCents),
          note: "closed and settled",
          tone: tone(m.totals.realizedCents),
        },
        {
          label: "Right",
          value: `${accuracy(stats)}%`,
          note: `${stats.correct} of ${stats.resolved} resolved`,
        },
        {
          label: "Fees paid",
          value: usd(m.totals.feesCents),
          note: "venue + imo fees",
        },
        {
          label: "Open positions",
          value: String(m.open.length),
          note: "at the bid, in Portfolio",
        },
      ]
    : [
        {
          label: `P&L · ${periodLabel(period)}`,
          value: signedUsd(stats.pnlCents),
          note: `net of ${usd(trader.record.feesCents)} fees`,
          tone: tone(stats.pnlCents),
        },
        {
          label: "All-time P&L",
          value: signedUsd(allTime.pnlCents),
          note: `realized ${whole(trader.record.realizedCents)} · unreal. ${whole(trader.record.unrealizedCents)}`,
          tone: tone(allTime.pnlCents),
        },
        {
          label: `ROI · ${periodLabel(period)}`,
          value: signedPct(stats.returnPct),
          note: `on ${compactUsd(stats.startingCapitalCents)} deployed`,
          tone: tone(stats.returnPct),
        },
        {
          label: "Right",
          value: `${accuracy(stats)}%`,
          note: `${stats.correct} of ${stats.resolved} resolved`,
        },
        {
          label: "Biggest loss",
          value: signedUsd(trader.record.biggestLossCents),
          note: trader.record.biggestLossOn,
          tone: "negative",
        },
        {
          label: "Max drawdown",
          value: whole(trader.record.maxDrawdownCents),
          note: trader.record.drawdownWindow,
          tone: "negative",
        },
      ];
  const tabs = [
    { label: "Predictions", count: m.predictions },
    { label: "Open positions", count: m.open.length },
    ...(self ? [{ label: "Backed", count: m.backed.length }] : []),
    { label: "Rooms", count: m.rooms.length },
  ];
  const people = followTab === "Followers" ? m.followers : m.followingList;
  const { visible: shownPeople, loadMore } = useListPagination(
    people,
    `${trader.id}:${followTab}`,
  );
  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.identity}>
          <Avatar trader={trader} size={84} />
          <div>
            <div className={styles.nameRow}>
              <h1>{trader.name}</h1>
              {self && <span className="tag tag-accent">Paper account</span>}
              {m.rank && (
                <span className="tag tag-neutral">#{m.rank} · 30d P&amp;L</span>
              )}
              {trader.focus && <span className="tag tag-neutral">{trader.focus}</span>}
              {m.lowSample && <span className="tag tag-gold">Low sample</span>}
            </div>
            <p className={styles.handle}>
              @{trader.handle} · joined {trader.joined}
            </p>
            <p className={styles.bio}>{trader.bio}</p>
            <div className={styles.counts}>
              <a
                href="#network"
                onClick={(e) => {
                  e.preventDefault();
                  setFollowTab("Followers");
                  document.getElementById("network")?.scrollIntoView({
                    block: "nearest",
                  });
                }}
              >
                <b>
                  {(trader.followers + (m.following ? 1 : 0)).toLocaleString()}
                </b>{" "}
                followers
              </a>
              <a
                href="#network"
                onClick={(e) => {
                  e.preventDefault();
                  setFollowTab("Following");
                }}
              >
                <b>{trader.following.toLocaleString()}</b> following
              </a>
              <span>
                <b>{m.rooms.length}</b> rooms
              </span>
            </div>
          </div>
          <div className={styles.identityActions}>
            {self ? (
              <>
                <Link href="/settings" className="btn btn-secondary">
                  <GearSix size={15} />
                  Edit profile
                </Link>
                <button
                  type="button"
                  className={`btn btn-secondary btn-icon ${styles.round}`}
                  aria-label="Copy link to your profile"
                  onClick={() => shareProfile(trader)}
                >
                  <Export size={16} />
                </button>
              </>
            ) : (
              <>
                <span className={styles.follow}>
                  <FollowButton trader={trader} />
                </span>
                <NotifyButton m={m} />
                <MoreMenu m={m} />
              </>
            )}
          </div>
        </header>
        <div className={styles.stats}>
          {headline.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <b className={s.tone}>{s.value}</b>
              <small>{s.note}</small>
            </div>
          ))}
        </div>
        <section className={styles.chartPanel}>
          <div className={styles.chartHead}>
            <h2>Cumulative P&amp;L · net of fees</h2>
            <div className={styles.segment} data-indicator="pill" role="group" aria-label="Period">
              {periods.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={period === p}
                  onClick={() => m.setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {path ? (
            <svg
              key={period}
              viewBox="0 0 900 140"
              preserveAspectRatio="none"
              className={`${styles.chart} draw`}
              role="img"
              aria-label={`${trader.name}: cumulative profit and loss over ${period}, ending at ${signedUsd(stats.pnlCents)}.`}
            >
              <path d={`${path} L900 140 L0 140 Z`} className={styles.area} />
              <path
                d={path}
                className={styles.line}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : (
            <p className={styles.chartEmpty} role="status">
              No P&amp;L history for {periodLabel(period)} yet: it builds up
              one day at a time.
            </p>
          )}
          <div className={styles.chartFoot}>
            <span>
              {period === "All"
                ? `Joined ${trader.joined}`
                : day(dataNow() - DAYS[period] * 86_400_000)}
            </span>
            <span>
              Drawdown {whole(trader.record.maxDrawdownCents)} ·{" "}
              {trader.record.drawdownWindow}
            </span>
            <span>{day(dataNow())}</span>
          </div>
        </section>
        <div className={styles.tabs} role="group" aria-label="Profile sections" data-indicator="line">
          {tabs.map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={tab === t.label}
              onClick={() => setTab(t.label)}
            >
              {t.label} · {t.count.toLocaleString("en-US")}
            </button>
          ))}
          {tab === "Predictions" && (
            <span className={styles.tabNote}>Resolved first</span>
          )}
        </div>
        {tab === "Predictions" && (
          <>
            <div className={styles.historyHead}>
              <span>Prediction</span>
              <span>Call</span>
              <span>Result</span>
              <span>Called it?</span>
              <span>Trade outcome</span>
              <span className={styles.num}>P&amp;L</span>
            </div>
            {m.rows.map((r) => (
              <div className={styles.historyRow} key={r.key}>
                <span className={styles.prediction}>
                  {r.href ? (
                    <Link href={r.href}>
                      <strong>{r.title}</strong>
                    </Link>
                  ) : (
                    <strong>{r.title}</strong>
                  )}
                  <span>{r.when}</span>
                </span>
                <span
                  className={`${styles.call} ${r.outcome === "Yes" ? styles.yes : styles.no}`}
                >
                  {r.outcome}
                </span>
                <span className={styles.result}>{r.result}</span>
                <Called right={r.right} />
                <span className={styles.result}>{r.trade}</span>
                <b
                  className={`${styles.num} ${tone(r.pnl)}`}
                >
                  {signedUsd(r.pnl)}
                </b>
              </div>
            ))}
            {m.predictions > m.rows.length && (
              <p className={styles.more}>
                The {m.rows.length} most recent of{" "}
                {m.predictions.toLocaleString("en-US")} predictions.
              </p>
            )}
            {m.posts.length > 0 ? (
              <div className={styles.posts}>
                <h2>Published reasoning</h2>
                {m.posts.map((p) => (
                  <PostCard post={p} key={p.id} />
                ))}
              </div>
            ) : (
              self && (
                <p className={styles.note}>
                  You haven’t published a prediction yet. Share your take from
                  the feed.
                </p>
              )
            )}
          </>
        )}
        {tab === "Open positions" && <OpenPositions m={m} />}
        {tab === "Backed" && <Backed m={m} />}
        {tab === "Rooms" && <Rooms m={m} />}
      </div>
      <aside className={styles.aside} aria-label="Performance and network">
        <section className={styles.context} aria-labelledby="context-title">
          <h2 id="context-title">Performance context</h2>
          <div className={styles.contextGrid}>
            <div>
              <span>Right, not profitable</span>
              <p>
                <b>{trader.record.rightNotProfitable}</b> predictions
              </p>
            </div>
            <div>
              <span>Profitable, not right</span>
              <p>
                <b>{trader.record.profitableNotRight}</b> sold early
              </p>
            </div>
            <div>
              <span>Win / loss trades</span>
              <p>
                <b>
                  {trader.record.winTrades} / {trader.record.lossTrades}
                </b>
              </p>
            </div>
            <div>
              <span>Avg. hold</span>
              <p>
                <b>{trader.record.avgHoldDays} days</b>
              </p>
            </div>
          </div>
          <p className={styles.disclaimer}>
            Past results don’t predict future ones. Figures cover paper trading
            on imo.
          </p>
        </section>
        <div
          id="network"
          className={styles.followTabs} data-indicator="line"
          role="group"
          aria-label="Network"
        >
          {(["Followers", "Following"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={followTab === t}
              onClick={() => setFollowTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {shownPeople.map((t) => (
          <div className={styles.peer} key={t.id}>
            <Link
              href={`/trader/${t.id}`}
              tabIndex={-1}
              aria-hidden="true"
              className={styles.peerAvatar}
            >
              <Avatar trader={t} size={34} />
            </Link>
            <Link href={`/trader/${t.id}`} className={styles.peerName}>
              <strong>{t.id === "you" ? `${t.name} (you)` : t.name}</strong>
              <span>
                {meta(`@${t.handle}`, t.focus)}
              </span>
            </Link>
            <FollowButton trader={t} compact />
          </div>
        ))}
        <TraderPagination
          shown={shownPeople.length}
          total={people.length}
          onLoadMore={loadMore}
        />
        {!people.length && (
          <p className={styles.note}>
            {followTab === "Following"
              ? "Not following anyone yet."
              : "No followers yet."}
          </p>
        )}
      </aside>
    </div>
  );
}

function Called({ right }: { right: boolean | null }) {
  return (
    <span
      className={
        right === null ? styles.pending : right ? "positive" : "negative"
      }
    >
      {right === null ? (
        "Pending"
      ) : right ? (
        <>
          <Check size={13} /> Right
        </>
      ) : (
        <>
          <X size={13} /> Wrong
        </>
      )}
    </span>
  );
}

/** 13.4 · open positions, unless the trader keeps them private. */
function OpenPositions({ m }: { m: Model }) {
  if (m.hidePositions)
    return (
      <div className={styles.private}>
        <EyeOff size={22} />
        <strong>
          {m.trader.name.split(" ")[0]} keeps open positions private
        </strong>
        <p>
          Predictions and resolved results are still public.
          {m.lowSample
            ? ` Only ${m.stats.resolved} resolved — treat the ${accuracy(m.stats)}% accuracy with care.`
            : ""}
        </p>
      </div>
    );
  if (!m.open.length)
    return <p className={styles.note}>No open positions right now.</p>;
  return (
    <div className={styles.openList}>
      {m.open.map((h) => (
        <Link
          href={`/market/${h.market.id}`}
          className={styles.openRow}
          key={h.key}
        >
          <span>
            <strong>{h.market.title}</strong>
            <span>
              {h.shares.toLocaleString()} {h.outcome} @ {h.entryPrice}¢ ·{" "}
              {venueName(h.market.venueId)}
            </span>
          </span>
          <span>
            <small>Now</small>
            <b>{h.now}¢</b>
          </span>
          <span>
            <small>Unrealized</small>
            <b className={tone(h.pnl)}>
              {signedUsd(h.pnl)}
            </b>
          </span>
          <ArrowUpRight size={15} />
        </Link>
      ))}
    </div>
  );
}

/** Predictions you backed or faded from the feed, and where they stand. */
function Backed({ m }: { m: Model }) {
  if (!m.backed.length)
    return (
      <p className={styles.note}>
        Nothing backed yet. Back or fade a prediction from the feed and it shows
        up here.
      </p>
    );
  return (
    <div className={styles.openList}>
      {m.backed.map(({ order, post }) => {
        const market = m.market(post.marketId);
        const author = m.author(post.authorId);
        const q = order.quote;
        const same = q.outcome === post.outcome;
        const pnl =
          (bestBid(market, q.outcome) - q.priceCents) * order.filledShares;
        return (
          <Link
            href={`/post/${post.id}`}
            className={styles.openRow}
            key={order.id}
          >
            <span>
              <strong>{market.title}</strong>
              <span>
                {same ? "Backed" : "Faded"} {author?.name ?? "a trader"} ·{" "}
                {order.filledShares.toLocaleString()} {q.outcome} @{" "}
                {centsText(q.priceCents)} · {timeLabel(order.at)}
              </span>
            </span>
            <span>
              <small>Now</small>
              <b>{bestBid(market, q.outcome)}¢</b>
            </span>
            <span>
              <small>Unrealized</small>
              <b className={tone(pnl)}>
                {signedUsd(pnl)}
              </b>
            </span>
            <ArrowUpRight size={15} />
          </Link>
        );
      })}
    </div>
  );
}

function Rooms({ m }: { m: Model }) {
  if (!m.rooms.length)
    return (
      <p className={styles.note}>
        {m.self
          ? "You haven’t joined a room yet."
          : `${m.trader.name} isn’t in a public room.`}
      </p>
    );
  return (
    <div className={styles.rooms}>
      {m.rooms.map((room) => (
        <Link
          href={`/rooms/${room.id}`}
          className={styles.roomRow}
          key={room.id}
        >
          <span className={styles.roomMark}>{room.symbol}</span>
          <span>
            <strong>{room.name}</strong>
            <span>
              {room.memberCount.toLocaleString()} members ·{" "}
              {room.watchlist.length} markets · {room.privacy}
            </span>
          </span>
          <ArrowUpRight size={15} />
        </Link>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- 13.2 phone */
function Phone({ m }: { m: Model }) {
  const { trader, self } = m;
  const tabs = self
    ? ["Predictions", "Positions", "Backed"]
    : ["Predictions", "Positions", "Rooms"];
  const [tab, setTab] = useState(tabs[0]);
  const { startCents } = useSeason();
  const allTime = self
    ? m.totals.totalCents - startCents
    : trader.stats.All.pnlCents;
  const all = trader.stats.All;
  return (
    <div className={styles.phone}>
      <header className={styles.phoneTop}>
        {!self && (
          <Link
            href="/leaderboard"
            className={`btn btn-icon ${styles.phoneIcon}`}
            aria-label="Back to the leaderboard"
          >
            <CaretLeft size={20} />
          </Link>
        )}
        <span className={styles.flex} />
        {self ? (
          <Link
            href="/settings"
            className={`btn btn-icon ${styles.phoneIcon}`}
            aria-label="Settings"
          >
            <GearSix size={20} />
          </Link>
        ) : (
          <MoreMenu m={m} quiet />
        )}
      </header>
      <section className={styles.phoneId}>
        <Avatar trader={trader} size={64} />
        <div className={styles.phoneName}>
          <h1>{trader.name}</h1>
          {self ? (
            <span className="tag tag-accent">Paper</span>
          ) : (
            m.rank && <span className="tag tag-neutral">#{m.rank} · 30d</span>
          )}
        </div>
        <p className={styles.phoneMeta}>
          {meta(
            `@${trader.handle}`,
            trader.focus,
            `${(trader.followers + (m.following ? 1 : 0)).toLocaleString()} followers`,
            `${trader.following.toLocaleString()} following`,
          )}
        </p>
        <div className={styles.phoneActions}>
          {self ? (
            <>
              <Link href="/settings" className="btn btn-secondary">
                Edit profile
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => shareProfile(trader)}
              >
                <Export size={15} />
                Share
              </button>
            </>
          ) : (
            <>
              <span className={styles.follow}>
                <FollowButton trader={trader} />
              </span>
              <NotifyButton m={m} />
            </>
          )}
        </div>
      </section>
      <dl className={styles.phoneStats}>
        <div>
          <dt>All-time P&amp;L</dt>
          <dd className={tone(allTime)}>
            {allTime >= 0 ? "▲" : "▼"} {compactSigned(allTime)}
          </dd>
        </div>
        <div>
          <dt>Right</dt>
          <dd>
            {all.correct} of {all.resolved}
          </dd>
          {all.resolved < MIN_SAMPLE && (
            <dd className={styles.sample}>Low sample</dd>
          )}
        </div>
        <div>
          <dt>Fees paid</dt>
          <dd>{usd(self ? m.totals.feesCents : trader.record.feesCents)}</dd>
        </div>
      </dl>
      <div className={styles.phoneTabs} role="group" aria-label="Show" data-indicator="line">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className={styles.phoneList}>
        {tab === "Predictions" &&
          (m.rows.length ? (
            m.rows.map((r) => {
              const body = (
                <>
                  <b className={styles.phoneTitle}>{r.title}</b>
                  <b className={tone(r.pnl)}>
                    {signedUsd(r.pnl)}
                  </b>
                  <span className={styles.phoneSub}>
                    {r.outcome} · {r.result}
                  </span>
                  <Called right={r.right} />
                </>
              );
              return r.href ? (
                <Link href={r.href} className={styles.phoneRow} key={r.key}>
                  {body}
                </Link>
              ) : (
                <div className={styles.phoneRow} key={r.key}>
                  {body}
                </div>
              );
            })
          ) : (
            <p className={styles.note}>No predictions yet.</p>
          ))}
        {tab === "Positions" && <OpenPositions m={m} />}
        {tab === "Backed" && <Backed m={m} />}
        {tab === "Rooms" && <Rooms m={m} />}
      </div>
    </div>
  );
}
