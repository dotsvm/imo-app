"use client";
import Link from "next/link";
import { useDemo } from "@/services/provider";
import { arrowUsd, tone } from "@imo/domain/money";
import { accuracy, bestAsk, bestBid, MIN_SAMPLE } from "@imo/domain/engine";
import type { Comment, Market, Outcome, Post } from "@imo/domain/types";
import { Avatar, CategoryIcon, relativeTime, timeLabel } from "@/components/ui";
import {
  ArrowRight,
  ArrowUpRight,
  BookmarkSimple,
  ChatCircle,
  DotsThree,
  Heart,
  Repeat,
  UserMinus,
  UserPlus,
  Users,
} from "@/components/icons";
import { Menu, MenuItem } from "@/components/menu";
import styles from "./feed-post.module.css";
import { venueName } from "@/data/venues";
import { Count } from "@/components/motion";

const statusText = (market: Market) =>
  market.status === "open"
    ? `Closes ${timeLabel(market.closesAt)}`
    : market.status === "closed"
      ? "Closed · awaiting result"
      : `Resolved ${market.resolution.outcome ?? ""}`.trim();

/** Each reply carries the commenter's own stake, so agreement is legible. */
function Reply({ comment, post }: { comment: Comment; post: Post }) {
  const { services } = useDemo();
  const trader = services.profiles.get(comment.authorId);
  if (!trader) return null;
  // The server says what each commenter holds; older replies fall back to
  // the commenter's loaded history.
  const held =
    comment.stake !== undefined
      ? comment.stake
      : trader.history.find((h) => h.marketId === post.marketId && h.exitPrice === undefined);
  const stake =
    comment.authorId === post.authorId
      ? "author"
      : held
        ? `holds ${held.shares.toLocaleString()} ${held.outcome}`
        : "no position";
  return (
    <div className={styles.reply}>
      <Link href={`/trader/${trader.id}`} aria-label={`${trader.name} profile`}>
        <Avatar trader={trader} size={28} />
      </Link>
      <div>
        <span className={styles.replyMeta}>
          <Link href={`/trader/${trader.id}`}>{trader.name}</Link>{" "}
          <span>
            {stake} · {relativeTime(comment.at)}
          </span>
        </span>
        <p>{comment.text}</p>
      </div>
    </div>
  );
}

/**
 * 06.1 prediction post: the author and their record, the reasoning, the
 * linked market with the author's side, entry and P&L, then Back and Fade.
 * Below 600px the same card takes the 06.2 phone layout.
 */
export function FeedPost({
  post,
  onTrade,
}: {
  post: Post;
  onTrade: (outcome: Outcome) => void;
}) {
  const { services, state } = useDemo();
  const trader = services.profiles.get(post.authorId)!;
  const market = services.markets.get(post.marketId)!;
  const stat = trader.stats["30D"];
  const lowSample = stat.resolved < MIN_SAMPLE;
  const own = trader.id === "you";
  const following = state.following.includes(trader.id);
  const liked = state.liked.includes(post.id);
  const saved = state.bookmarked.includes(post.id);
  const opposite: Outcome = post.outcome === "Yes" ? "No" : "Yes";
  const tradable = market.status === "open";
  const disclosed = post.disclosePosition && post.evidenceShares > 0;
  // Open positions mark to the executable bid, as the portfolio does.
  const unrealized = disclosed
    ? (bestBid(market, post.outcome) - post.entryPrice) * post.evidenceShares
    : 0;
  const side = post.outcome === "Yes" ? "side-yes" : "side-no";
  const record = `${accuracy(stat)}% right · ${stat.resolved} resolved`;
  const position = disclosed
    ? `${post.evidenceShares.toLocaleString()} @ ${post.entryPrice}¢`
    : post.disclosePosition
      ? "No position"
      : "Private";
  const replies = post.comments.filter((c) => !c.parentId);
  const preview = replies.slice(0, 2);
  const firstName = trader.name.split(" ")[0];

  return (
    <article
      className={`${styles.post} feed-post rise`}
      id={post.id}
      aria-labelledby={`${post.id}-author`}
    >
      <Link
        href={`/trader/${trader.id}`}
        className={styles.avatar}
        aria-label={`${trader.name} profile`}
      >
        <Avatar trader={trader} size={36} />
      </Link>

      <div className={styles.head}>
        <span className={styles.who}>
          <Link
            href={`/trader/${trader.id}`}
            className={styles.name}
            id={`${post.id}-author`}
          >
            {trader.name}
          </Link>
          <span className={styles.handle}>
            @{trader.handle} · {relativeTime(post.at)}
          </span>
          <span
            className={`tag ${lowSample ? "tag-accent" : "tag-neutral"} ${styles.record}`}
          >
            {lowSample ? `${stat.resolved} resolved · low sample` : record}
          </span>
        </span>
        {/* Phone: the record joins the timestamp under the name. */}
        <span className={styles.metaLine}>
          {relativeTime(post.at)} · {record}
        </span>
        {!own && (
          <button
            className={`btn ${following ? "btn-secondary" : "btn-primary"} ${styles.follow}`}
            aria-pressed={following}
            aria-label={`${following ? "Unfollow" : "Follow"} ${trader.name}`}
            onClick={() => services.profiles.toggleFollow(trader.id)}
          >
            {following ? "Following" : "Follow"}
          </button>
        )}
        <Menu
          label={`More actions for ${firstName}’s prediction`}
          className={styles.postMenu}
          triggerClassName={`btn btn-icon ${styles.postMenuButton}`}
          trigger={<DotsThree size={18} />}
        >
          {!own && (
            <MenuItem
              icon={following ? <UserMinus /> : <UserPlus />}
              onSelect={() => services.profiles.toggleFollow(trader.id)}
            >
              {following ? `Unfollow ${firstName}` : `Follow ${firstName}`}
            </MenuItem>
          )}
          {tradable && (
            <MenuItem icon={<ArrowRight />} onSelect={() => onTrade(opposite)}>
              Fade · {opposite} {bestAsk(market, opposite)}¢
            </MenuItem>
          )}
          <MenuItem icon={<ArrowUpRight />} href={`/post/${post.id}`}>
            Open prediction
          </MenuItem>
        </Menu>
      </div>

      <Link href={`/post/${post.id}`} className={styles.text}>
        {post.text}
      </Link>

      <Link
        href={`/market/${market.id}`}
        className={`${styles.market} feed-post-market`}
      >
        <span className={styles.marketIcon} aria-hidden="true">
          <CategoryIcon category={market.category} size={16} />
        </span>
        <span className={styles.marketTitle}>
          <b className={styles.marketFull}>{market.title}</b>
          <b className={styles.marketShort}>{market.shortTitle}</b>
          <span className={styles.marketMeta}>
            {venueName(market.venueId)} · {statusText(market)} · Yes{" "}
            {market.yesPrice}¢
          </span>
          <span className={styles.marketMetaPhone}>
            {post.outcome} · {position} · {venueName(market.venueId)}
          </span>
        </span>
        <span className={styles.marketPosition}>
          <span className={styles.marketLabel}>
            {disclosed ? "Their position" : "Their call"}
          </span>
          <b>
            <span className={`side ${side}`}>{post.outcome}</span>
            {disclosed ? (
              position
            ) : (
              <span className={styles.noStake}>{position.toLowerCase()}</span>
            )}
          </b>
        </span>
        <span className={styles.marketPnl}>
          <span className={styles.marketLabel}>Unrealized</span>
          <b
            className={
              !disclosed ? undefined : tone(unrealized)
            }
          >
            {disclosed ? arrowUsd(unrealized) : "—"}
          </b>
        </span>
      </Link>

      <div className={styles.actions}>
        <Link
          href={`/post/${post.id}#replies`}
          className={styles.stat}
          aria-label={`${post.commentCount ?? post.comments.length} replies`}
        >
          <ChatCircle size={14} />
          {post.commentCount ?? post.comments.length}
        </Link>
        <span
          className={`${styles.stat} ${styles.reposts}`}
          role="img"
          aria-label={`${post.reposts} reposts`}
        >
          <Repeat size={14} />
          {post.reposts}
        </span>
        <button
          className={`${styles.stat} ${styles.like} pop`}
          aria-pressed={liked}
          aria-label={`Like prediction by ${trader.name}`}
          onClick={() => services.social.toggleLike(post.id)}
        >
          <Heart size={14} />
          <Count value={post.likes} />
        </button>
        <button
          className={`${styles.stat} ${styles.save} pop`}
          aria-pressed={saved}
          aria-label="Bookmark prediction"
          onClick={() => services.social.toggleBookmark(post.id)}
        >
          <BookmarkSimple size={14} />
        </button>
        <span
          className={`${styles.stat} ${styles.backers}`}
          role="img"
          aria-label={`${post.backed} readers backed this call`}
        >
          <Users size={14} />
          {post.backed}
          <span className={styles.backersWord}>backed</span>
        </span>
        <span className={styles.spacer} />
        <button
          className={`${styles.back} ${styles.fade} ${
            opposite === "Yes" ? "side-yes" : "side-no"
          }`}
          onClick={() => onTrade(opposite)}
          disabled={!tradable}
        >
          Fade · {opposite} {bestAsk(market, opposite)}¢
        </button>
        <button
          className={`${styles.back} ${side}`}
          onClick={() => onTrade(post.outcome)}
          disabled={!tradable}
        >
          {tradable
            ? `Back ${post.outcome} ${bestAsk(market, post.outcome)}¢`
            : market.status === "closed"
              ? "Trading halted"
              : "Resolved"}
          {tradable && <ArrowRight size={14} className={styles.backArrow} />}
        </button>
      </div>

      {preview.length > 0 && (
        <div className={styles.thread}>
          {preview.map((c) => (
            <Reply key={c.id} comment={c} post={post} />
          ))}
          {(post.commentCount ?? post.comments.length) > preview.length && (
            <Link
              href={`/post/${post.id}#replies`}
              className={styles.moreReplies}
            >
              View all {post.commentCount ?? post.comments.length} replies
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
