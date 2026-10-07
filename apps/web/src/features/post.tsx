"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Eye,
  Heart,
  MessageSquare,
  Repeat2,
  Share,
  ShieldCheck,
  MoreHorizontal,
  Users,
} from "@/components/icons";
import { useDemo, useLive, useLoadingView } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import { priceFor, signedUsd, tone } from "@imo/domain/money";
import { accuracy, bestAsk, bestBid } from "@imo/domain/engine";
import type { Comment, Outcome, Post } from "@imo/domain/types";
import { Avatar, Button, Empty, FollowButton, Modal, relativeTime, meta } from "@/components/ui";
import { Sparkline } from "@/components/chart";
import { TradeTicket } from "./trade";
import { PostFigures } from "./post-figures";
import { ReportDialog } from "./report-dialog";
import styles from "./post.module.css";
import { venueName } from "@/data/venues";
import { Count } from "@/components/motion";

type ReplyFilter = "Top" | "Newest" | "Holders only" | "Disagree";
const postedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

const replyFilters: ReplyFilter[] = [
  "Top",
  "Newest",
  "Holders only",
  "Disagree",
];

/** A reply's own stance, used for the side pill and the Disagree filter. */
function stanceFor(
  post: Post,
  comment: Comment,
  holding: { outcome: Outcome; shares: number } | null,
) {
  if (comment.authorId === post.authorId)
    return {
      label: `${post.outcome} · ${post.evidenceShares || "no shares"} · author`,
      outcome: post.outcome,
      agrees: true,
      holder: post.evidenceShares > 0,
    };
  if (!holding)
    return { label: "No position", outcome: null, agrees: true, holder: false };
  return {
    label: `${holding.outcome} · ${holding.shares.toLocaleString()}`,
    outcome: holding.outcome,
    agrees: holding.outcome === post.outcome,
    holder: true,
  };
}

/** The prediction's page while it loads: thread on the left, the market and
    the author's record on the right, in the page's own columns. */
function PostLoading() {
  return (
    <Loading label="Loading this prediction" className={styles.screen}>
      <div className={styles.page}>
        <div className={styles.thread}>
          <div className={styles.threadBar}>
            <span className={styles.back}>
              <ArrowLeft size={15} />
              Feed
            </span>
            <Bone circle={30} />
            <Bone circle={30} />
          </div>
          <div className={styles.post}>
            <div className={styles.author}>
              <Bone circle={36} />
              <div>
                <Bone w={130} h={14} />
                <Bone w={280} h={10} style={{ marginTop: 7 }} />
              </div>
              <Bone w={78} h={32} r="pill" />
            </div>
            <div className={styles.badges}>
              <Bone w={96} h={22} r={6} />
              <Bone w={128} h={22} r={6} />
            </div>
            <BoneLines lines={3} h={14} gap={11} last="48%" />
            <Bone w="100%" h={96} r={12} style={{ marginTop: 16 }} />
            <div className={styles.metrics}>
              {[64, 34, 34, 104, 46].map((w, i) => (
                <Bone key={i} w={w} h={11} />
              ))}
            </div>
          </div>
          <div className={styles.replyBox}>
            <Bone circle={30} />
            <Bone w="100%" h={36} r="pill" />
          </div>
          <div className={styles.replyFilters} aria-hidden="true">
            {[34, 60, 84, 56].map((w) => (
              <Bone key={w} w={w} h={26} r="pill" />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.reply}>
              <Bone circle={30} />
              <div>
                <Bone w={i ? 150 : 190} h={11} />
                <BoneLines lines={2} h={11} last={i ? "40%" : "70%"} />
              </div>
            </div>
          ))}
        </div>
        <aside className={styles.aside}>
          <h2 className={styles.asideHeading}>Market snapshot</h2>
          <div className={styles.snapshot}>
            <div className={styles.prices}>
              {[0, 1].map((i) => (
                <div key={i}>
                  <Bone w={22} h={9} />
                  <Bone w={56} h={26} style={{ marginTop: 6 }} />
                </div>
              ))}
            </div>
            <Bone w="100%" h={44} r={8} />
            <BoneLines lines={3} h={10} last="55%" />
            <Bone w="100%" h={36} r="pill" />
          </div>
          <div className={styles.asideHeading}>
            <Bone w={96} h={10} />
          </div>
          <div className={styles.record}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Bone w={70} h={9} />
                <Bone w={i % 2 ? 80 : 60} h={18} style={{ marginTop: 7 }} />
              </div>
            ))}
          </div>
          <h2 className={styles.asideHeading}>Who’s on each side</h2>
          <div className={styles.sides}>
            <Bone w="100%" h={8} r={4} />
            <BoneLines lines={2} h={10} last="65%" />
          </div>
        </aside>
      </div>
    </Loading>
  );
}

export function PostDetail({ id }: { id: string }) {
  const { state, services } = useDemo();
  const loading = useLoadingView();
  useLive("post", id);
  const [filter, setFilter] = useState<ReplyFilter>("Top");
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<Outcome | null>(null);
  const [shared, setShared] = useState(false);
  const [reporting, setReporting] = useState(false);
  const post = state.posts.find((p) => p.id === id);
  // The author's whole record: their category and biggest-loss lines.
  useLive("trader", post?.authorId);
  const author = post ? services.profiles.get(post.authorId) : undefined;
  const market = post ? services.markets.get(post.marketId) : undefined;

  // Who holds what in this market, for the side pill on every reply.
  const holdings = new Map<string, { outcome: Outcome; shares: number }>();
  if (post) {
    // Each reply comes with its author's stake in this market.
    for (const c of post.comments) if (c.stake) holdings.set(c.authorId, c.stake);
    for (const position of state.positions)
      if (position.marketId === post.marketId)
        holdings.set("you", {
          outcome: position.outcome,
          shares: position.shares,
        });
  }

  // Still on its way (the post, or the market it's about): its skeleton, not
  // "isn't available" — that's for what the server says isn't there.
  if (
    loading ||
    (!post && services.pending("post", id)) ||
    (!!post && !market && services.pending("market", post.marketId)) ||
    !!author?.pending
  )
    return <PostLoading />;
  if (!post || !author || !market)
    return (
      <Empty
        title="This prediction isn’t available"
        description="It may have been deleted, or the link is mistyped. The feed has plenty of other views."
        action={
          <Link href="/feed" className="button primary">
            Back to the feed
          </Link>
        }
      />
    );

  const roots = post.comments.filter((c) => !c.parentId);
  const filtered = roots
    .filter((c) => {
      const stance = stanceFor(post, c, holdings.get(c.authorId) ?? null);
      if (filter === "Holders only") return stance.holder;
      if (filter === "Disagree") return !stance.agrees;
      return true;
    })
    .toSorted((a, b) =>
      filter === "Newest"
        ? Date.parse(b.at) - Date.parse(a.at)
        : (b.likes ?? 0) - (a.likes ?? 0),
    );
  const liked = state.liked.includes(post.id);
  const bookmarked = state.bookmarked.includes(post.id);
  const current = priceFor(market, post.outcome);
  // Open positions mark to the executable bid, as the feed and portfolio do.
  const unrealized = post.evidenceShares
    ? (bestBid(market, post.outcome) - post.entryPrice) * post.evidenceShares
    : 0;
  const opposite: Outcome = post.outcome === "Yes" ? "No" : "Yes";
  const yourPosition = holdings.get("you");
  const stats = author.stats["30D"];
  const categoryRecord = author.categories[market.category];
  // A headcount of Hunch traders on each side, which is not the price.
  const holderCount = market.holders.yes + market.holders.no;
  const yesShare = holderCount ? Math.round((market.holders.yes / holderCount) * 100) : 50;
  // 07.1 names who is in the thread and where they stand.
  const sideNote = (() => {
    const named = roots
      .map((c) => services.profiles.get(c.authorId))
      .filter((t) => t && t.id !== "you" && t.id !== post.authorId)
      .slice(0, 2)
      .map((t) => {
        const held = holdings.get(t!.id);
        return `${t!.name} (${held ? held.outcome : "no position"})`;
      });
    return named.length ? `Includes ${named.join(", ")}.` : "";
  })();
  /** The phone's share sheet where there is one; else the link, copied. */
  const share = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `${author.name} on ${market.shortTitle}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), 2_000);
      }
    } catch {
      // They closed the share sheet.
    }
  };
  const submitReply = () => {
    try {
      services.social.comment(post.id, reply, replyTo?.id);
      setReply("");
      setReplyTo(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <div className={styles.thread}>
          <div className={styles.threadBar}>
            <Link href="/feed" className={styles.back}>
              <ArrowLeft size={15} />
              Feed
            </Link>
            <button
              aria-label={
                bookmarked ? "Remove bookmark" : "Bookmark prediction"
              }
              aria-pressed={bookmarked}
              className={bookmarked ? `${styles.saved} pop` : "pop"}
              onClick={() => services.social.toggleBookmark(post.id)}
            >
              <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
            </button>
            <button
              aria-label={shared ? "Link copied" : "Share prediction"}
              title={shared ? "Link copied" : "Share"}
              onClick={() => void share()}
            >
              <Share size={16} />
            </button>
            {post.authorId !== "you" && (
              <button aria-label="Report prediction" title="Report" onClick={() => setReporting(true)}>
                <MoreHorizontal size={16} />
              </button>
            )}
            <ReportDialog
              open={reporting}
              onOpenChange={setReporting}
              subject={{ type: "post", id: post.id }}
              what="prediction"
            />
          </div>
          <article className={styles.post}>
            <header className={styles.author}>
              <Link
                href={`/trader/${author.id}`}
                aria-label={`${author.name} profile`}
              >
                <Avatar trader={author} />
              </Link>
              <div>
                <h1>{author.name}</h1>
                <span>
                  {meta(
                    `@${author.handle}`,
                    author.focus,
                    `${accuracy(stats)}% right over ${stats.resolved} resolved`,
                    postedAt(post.at),
                  )}
                </span>
              </div>
              <FollowButton trader={author} />
            </header>
            <div className={styles.badges}>
              <span className={styles.stance}>Predicts {post.outcome}</span>
              <span className="tag tag-neutral">
                Confidence · {post.confidence}
              </span>
              {post.disclosePosition && post.evidenceShares > 0 && (
                <span className="tag tag-neutral">
                  <ShieldCheck size={11} /> Position opened before posting
                </span>
              )}
            </div>
            <p className={styles.reasoning}>{post.text}</p>
            {post.invalidation && (
              <p className={styles.invalidation}>{post.invalidation}</p>
            )}
            <PostFigures images={post.images} />
            <div className={styles.linked}>
              <Link
                href={`/market/${market.id}`}
                className={styles.linkedMarket}
              >
                <strong>{market.title}</strong>
                <span>
                  {venueName(market.venueId)} ·{" "}
                  {post.evidenceShares
                    ? `${post.evidenceShares.toLocaleString()} ${post.outcome} @ ${post.entryPrice}¢ · now ${current}¢ · `
                    : "no disclosed position · "}
                  {post.evidenceShares > 0 && (
                    <b className={tone(unrealized)}>
                      {signedUsd(unrealized)}
                    </b>
                  )}
                </span>
              </Link>
              <div className={styles.linkedActions}>
                <button
                  className={`${styles.backBtn} ${post.outcome === "Yes" ? "side-yes" : "side-no"}`}
                  onClick={() => setTicket(post.outcome)}
                  disabled={market.status !== "open"}
                >
                  Back · {post.outcome} {bestAsk(market, post.outcome)}¢
                </button>
                <button
                  className={`${styles.fade} ${opposite === "Yes" ? "side-yes" : "side-no"}`}
                  onClick={() => setTicket(opposite)}
                  disabled={market.status !== "open"}
                >
                  Fade · {opposite} {bestAsk(market, opposite)}¢
                </button>
              </div>
            </div>
            <div className={styles.metrics}>
              <span>
                <MessageSquare size={14} />
                {post.commentCount ?? post.comments.length} replies
              </span>
              <span>
                <Repeat2 size={14} />
                {post.reposts}
              </span>
              <button
                aria-pressed={liked}
                aria-label={`Like ${author.name}’s prediction`}
                className={liked ? `${styles.liked} pop` : "pop"}
                onClick={() => services.social.toggleLike(post.id)}
              >
                <Heart size={14} fill={liked ? "currentColor" : "none"} />
                <Count value={post.likes} />
              </button>
              <span>
                <Users size={14} />
                {post.backed} backed · {post.faded} faded
              </span>
              <span>
                <Eye size={14} />
                {post.views.toLocaleString()}
              </span>
            </div>
          </article>
          <form
            id="replies"
            className={styles.replyBox}
            onSubmit={(e) => {
              e.preventDefault();
              submitReply();
            }}
          >
            <Avatar trader={services.profiles.get("you")!} small />
            <label className="sr-only" htmlFor="post-reply">
              {replyTo
                ? `Reply to ${services.profiles.get(replyTo.authorId)?.name}`
                : `Reply to ${author.name}`}
            </label>
            <input
              id="post-reply"
              value={reply}
              maxLength={1200}
              onChange={(e) => setReply(e.target.value)}
              placeholder={
                replyTo
                  ? `Reply to ${services.profiles.get(replyTo.authorId)?.name}…`
                  : "Post your reply"
              }
            />
            {replyTo && (
              <Button onClick={() => setReplyTo(null)} type="button">
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!reply.trim()}>
              Reply
            </Button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div
            className={styles.replyFilters}
            role="group"
            aria-label="Sort replies"
          >
            {replyFilters.map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {filtered.map((comment) => {
            const children = post.comments.filter(
              (c) => c.parentId === comment.id,
            );
            return [comment, ...children].map((c, depth) => {
              const trader = services.profiles.get(c.authorId)!;
              const stance = stanceFor(
                post,
                c,
                holdings.get(c.authorId) ?? null,
              );
              return (
                <div
                  key={c.id}
                  className={`${styles.reply} post-reply rise`}
                  data-nested={depth > 0 || undefined}
                >
                  <Link
                    href={`/trader/${trader.id}`}
                    aria-label={`${trader.name} profile`}
                  >
                    <Avatar trader={trader} small />
                  </Link>
                  <div>
                    <div className={styles.replyMeta}>
                      <strong>
                        {trader.name}
                        {trader.id === "you" ? " · you" : ""}
                      </strong>
                      <span
                        className={
                          stance.outcome === "Yes"
                            ? styles.yes
                            : stance.outcome === "No"
                              ? styles.no
                              : styles.neutral
                        }
                      >
                        {stance.label}
                      </span>
                      <span className={styles.replyTime}>
                        {relativeTime(c.at)}
                      </span>
                    </div>
                    <p>{c.text}</p>
                    <div className={styles.replyActions}>
                      <button
                        aria-label={`Reply to ${trader.name}`}
                        onClick={() => setReplyTo(c)}
                      >
                        Reply
                      </button>
                      <span>
                        <Heart size={12} />
                        {c.likes ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
              );
            });
          })}
          {!filtered.length && (
            <p className={styles.noReplies}>
              {roots.length
                ? "No replies match this filter."
                : "No replies yet. Add the first counterpoint."}
            </p>
          )}
        </div>
        <aside className={styles.aside}>
          <h2 className={styles.asideHeading}>Market snapshot</h2>
          <div className={styles.snapshot}>
            <div className={styles.prices}>
              <div>
                <span>Yes</span>
                <b>{priceFor(market, "Yes")}¢</b>
              </div>
              <div>
                <span>No</span>
                <b className="negative">{priceFor(market, "No")}¢</b>
              </div>
            </div>
            <Sparkline data={market.series} negative={market.change < 0} />
            <p>{market.resolution.rule}</p>
            <Link
              href={`/market/${market.id}`}
              className="button secondary full"
            >
              Open market · rules &amp; book
              <ArrowRight size={14} />
            </Link>
          </div>
          <h2 className={styles.asideHeading}>
            {author.name.split(" ")[0]}’s record
          </h2>
          <div className={styles.record}>
            <div>
              <span>Right</span>
              <b>{accuracy(stats)}%</b>
              <small>{stats.resolved} resolved</small>
            </div>
            <div>
              <span>P&amp;L · 30d</span>
              <b className={tone(stats.pnlCents)}>
                {signedUsd(stats.pnlCents)}
              </b>
              <small>net of fees</small>
            </div>
            <div>
              <span>On {market.category} markets</span>
              <b>
                {categoryRecord
                  ? `${categoryRecord.correct} / ${categoryRecord.resolved} right`
                  : "No resolved markets"}
              </b>
            </div>
            <div>
              <span>Biggest loss</span>
              <b className="negative">
                {signedUsd(author.record.biggestLossCents)}
              </b>
            </div>
          </div>
          <h2 className={styles.asideHeading}>Who’s on each side</h2>
          <div className={styles.sides}>
            {holderCount > 0 ? (
              <>
                <div className={styles.sideBar} aria-hidden="true">
                  <span style={{ width: `${yesShare}%` }} />
                  <span style={{ width: `${100 - yesShare}%` }} />
                </div>
                <div className={styles.sideLegend}>
                  <span>
                    <b>Yes · {yesShare}%</b> of {holderCount.toLocaleString()} imo
                    {holderCount === 1 ? " trader" : " traders"}
                  </span>
                  <span className="negative">
                    <b>No · {100 - yesShare}%</b>
                  </span>
                </div>
              </>
            ) : (
              <p>No one on imo holds this market yet.</p>
            )}
            <p>
              {sideNote}{" "}
              {yourPosition
                ? `You hold ${yourPosition.shares.toLocaleString()} ${yourPosition.outcome}.`
                : "You hold no position in this market."}
            </p>
          </div>
        </aside>
      </div>
      <div className={styles.mobileActions}>
        <button
          className={`${styles.backBtn} ${post.outcome === "Yes" ? "side-yes" : "side-no"}`}
          onClick={() => setTicket(post.outcome)}
          disabled={market.status !== "open"}
        >
          <span>Back</span>
          <b>
            {post.outcome} {bestAsk(market, post.outcome)}¢
          </b>
        </button>
        <button
          className={`${styles.fade} ${opposite === "Yes" ? "side-yes" : "side-no"}`}
          onClick={() => setTicket(opposite)}
          disabled={market.status !== "open"}
        >
          <span>Fade</span>
          <b>
            {opposite} {bestAsk(market, opposite)}¢
          </b>
        </button>
      </div>
      <Modal
        open={!!ticket}
        onOpenChange={(open) => {
          if (!open) setTicket(null);
        }}
        title={
          ticket === post.outcome
            ? `Back ${author.name} · ${ticket}`
            : `Fade ${author.name} · ${ticket}`
        }
        description="Your own simulated order, reviewed independently of the prediction."
      >
        {ticket && (
          <TradeTicket key={ticket} market={market} initialOutcome={ticket} />
        )}
      </Modal>
    </div>
  );
}
