"use client";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  Bookmark,
  ArrowUpRight,
  Send,
  ShieldCheck,
  ArrowRight,
  Check,
  UserCheck,
  UserPlus,
  ChevronDown,
  Globe2,
  Users,
  ChartNoAxesCombined,
  Smile,
  SlidersHorizontal,
  NotebookPen,
  Trash2,
  Search,
  Plus,
  X,
} from "@/components/icons";
import { useDemo } from "@/services/provider";
import type { Post, Outcome, Confidence } from "@imo/domain/types";
import { compactUsd, priceFor, signedUsd } from "@imo/domain/money";
import {
  Avatar,
  Button,
  CategoryIcon,
  FollowButton,
  Modal,
  Segmented,
  timeLabel,
} from "@/components/ui";
import { VenueBadge } from "@/components/market-bits";
import composer from "./composer.module.css";
import { venueName } from "@/data/venues";
import { Count } from "@/components/motion";
export function PostCard({
  post,
  expanded = false,
  onTrade,
}: {
  post: Post;
  expanded?: boolean;
  onTrade?: (outcome: Outcome) => void;
}) {
  const { services, state } = useDemo();
  const [comments, setComments] = useState(expanded);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const trader = services.profiles.get(post.authorId)!,
    market = services.markets.get(post.marketId)!;
  const comment = () => {
    try {
      services.social.comment(post.id, text);
      setText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <article className="post-card rise" id={post.id}>
      <div className="post-header">
        <Link href={`/trader/${trader.id}`} className="post-author">
          <Avatar trader={trader} />
          <span>
            <strong>
              {trader.name}{" "}
              <span className="author-handle">@{trader.handle}</span>
            </strong>
            <span>
              {onTrade
                ? `${trader.stats["30D"].resolved ? Math.round((trader.stats["30D"].correct / trader.stats["30D"].resolved) * 100) : 0}% right · ${trader.stats["30D"].resolved} resolved`
                : `${trader.stats["30D"].returnPct >= 0 ? "+" : ""}${trader.stats["30D"].returnPct}% 30d return`}{" "}
              <span>· {timeLabel(post.at)}</span>
            </span>
          </span>
        </Link>
        {onTrade && trader.id !== "you" ? (
          <button
            className="terminal-follow"
            aria-label={`${state.following.includes(trader.id) ? "Unfollow" : "Follow"} ${trader.name}`}
            aria-pressed={state.following.includes(trader.id)}
            onClick={() => services.profiles.toggleFollow(trader.id)}
          >
            {state.following.includes(trader.id) ? (
              <UserCheck size={15} />
            ) : (
              <UserPlus size={15} />
            )}
          </button>
        ) : (
          <FollowButton trader={trader} compact />
        )}
      </div>
      <p className="post-reasoning">{post.text}</p>
      {onTrade ? (
        <Link
          href={`/market/${market.id}`}
          className="post-linked-market terminal-market"
          title={market.title}
        >
          <span className="terminal-category">
            {market.category.slice(0, 3).toUpperCase()}
          </span>
          <span className="terminal-market-title">
            <strong>{market.title}</strong>
            <span>
              {venueName(market.venueId)} ·{" "}
              {market.status === "open" ? "Open" : "Resolved"} · Yes{" "}
              {market.yesPrice}¢
            </span>
          </span>
          <span className="terminal-holding">
            <span>Their position</span>
            <b>
              <span className={`terminal-side ${post.outcome.toLowerCase()}`}>
                {post.outcome}
              </span>
              {post.evidenceShares
                ? `${post.evidenceShares} @ ${post.entryPrice}¢`
                : "No shares"}
            </b>
          </span>
          <span className="terminal-pnl">
            <span>Unrealized</span>
            <b
              className={
                priceFor(market, post.outcome) >= post.entryPrice
                  ? "positive"
                  : "negative"
              }
            >
              {post.evidenceShares
                ? signedUsd(
                    (priceFor(market, post.outcome) - post.entryPrice) *
                      post.evidenceShares,
                  )
                : "—"}
            </b>
          </span>
        </Link>
      ) : (
        <Link href={`/market/${market.id}`} className="post-linked-market">
          <div>
            <span className={`position-pill ${post.outcome.toLowerCase()}`}>
              {post.outcome}
            </span>
            <strong>{market.title}</strong>
            <ArrowUpRight size={16} />
          </div>
          <div className="post-entry">
            <span>
              Entry <strong>{post.entryPrice}¢</strong>
            </span>
            <span className="entry-divider">→</span>
            <span>
              Current <strong>{priceFor(market, post.outcome)}¢</strong>
            </span>
            <span className="muted">{venueName(market.venueId)}</span>
          </div>
        </Link>
      )}
      <div className="position-evidence">
        <ShieldCheck size={13} />
        {post.evidenceShares && post.disclosePosition
          ? `${post.evidenceShares} shares · position on record`
          : "No position held"}
        <span>Confidence · {post.confidence}</span>
      </div>
      <div className="post-actions">
        <button
          aria-pressed={state.liked.includes(post.id)}
          aria-label={`Like prediction by ${trader.name}`}
          className={state.liked.includes(post.id) ? "is-liked pop" : "pop"}
          onClick={() => services.social.toggleLike(post.id)}
        >
          <Heart
            size={17}
            fill={state.liked.includes(post.id) ? "currentColor" : "none"}
          />
          <Count value={post.likes} />
        </button>
        <button
          onClick={() => setComments(!comments)}
          aria-expanded={comments}
          aria-label={`Comments on ${trader.name}'s prediction`}
        >
          <MessageCircle size={17} />
          <Count value={post.commentCount ?? post.comments.length} />
        </button>
        <button
          onClick={() => services.social.toggleBookmark(post.id)}
          aria-pressed={state.bookmarked.includes(post.id)}
          aria-label="Bookmark prediction"
          className={state.bookmarked.includes(post.id) ? "is-saved pop" : "pop"}
        >
          <Bookmark
            size={17}
            fill={state.bookmarked.includes(post.id) ? "currentColor" : "none"}
          />
        </button>
        <Link href={`/post/${post.id}`} className="thread-link">
          Thread
          <ArrowUpRight size={14} />
        </Link>
        {onTrade ? (
          <div className="terminal-trade-actions">
            <button
              className="fade-action"
              onClick={() => onTrade(post.outcome === "Yes" ? "No" : "Yes")}
              disabled={market.status !== "open"}
            >
              Fade · {post.outcome === "Yes" ? "No" : "Yes"}{" "}
              {priceFor(market, post.outcome === "Yes" ? "No" : "Yes")}¢
            </button>
            <button
              className={`back-action ${post.outcome.toLowerCase()}`}
              onClick={() => onTrade(post.outcome)}
              disabled={market.status !== "open"}
            >
              {market.status === "open"
                ? `Back ${post.outcome} ${priceFor(market, post.outcome)}¢`
                : "Resolved"}
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <Link href={`/market/${market.id}?outcome=${post.outcome}&trade=1`}>
            Trade this view
            <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
      {comments && (
        <div className="post-comments">
          {post.comments.map((c) => (
            <div className="comment" key={c.id}>
              <Avatar trader={services.profiles.get(c.authorId)!} small />
              <div>
                <strong>{services.profiles.get(c.authorId)!.name}</strong>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
          {!post.comments.length && (
            <p className="muted">Start the discussion. What’s your take?</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              comment();
            }}
          >
            <label className="sr-only" htmlFor={`comment-${post.id}`}>
              Add a comment
            </label>
            <input
              id={`comment-${post.id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add to the conversation…"
              maxLength={1200}
            />
            <Button
              type="submit"
              disabled={!text.trim()}
              aria-label="Post comment"
            >
              <Send size={16} />
            </Button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </article>
  );
}
const MAX_REASONING = 600;
const confidences: Confidence[] = ["Low", "Medium", "High"];
const DRAFT_KEY = "hunch-prediction-drafts-v1";
type PredictionDraft = {
  id: string;
  marketId: string;
  outcome: Outcome;
  text: string;
  confidence: Confidence;
  audience: string;
  disclosePosition: boolean;
};

function readDrafts(): PredictionDraft[] {
  const value: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]");
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (draft): draft is PredictionDraft =>
        draft &&
        typeof draft.id === "string" &&
        typeof draft.marketId === "string" &&
        typeof draft.text === "string" &&
        draft.text.length <= MAX_REASONING &&
        (draft.outcome === "Yes" || draft.outcome === "No") &&
        confidences.includes(draft.confidence) &&
        typeof draft.audience === "string" &&
        typeof draft.disclosePosition === "boolean",
    )
    .slice(0, 5);
}

export function Composer({
  open,
  onOpenChange,
  marketId,
  initialOutcome = "Yes",
  initialText = "",
  initialAudience = "public",
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  marketId?: string;
  /** Mount-time presets, e.g. from a filled order or a market's reply box. */
  initialOutcome?: Outcome;
  initialText?: string;
  /** "public" or a room you belong to. */
  initialAudience?: string;
}) {
  const { state, services } = useDemo();
  const allMarkets = services.markets.list();
  const [selected, setSelected] = useState(marketId || "");
  const [marketQuery, setMarketQuery] = useState("");
  const searchTerms = marketQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  // What's loaded answers at once; the server searches every market.
  const asked = marketQuery.trim();
  const found = asked.length >= 2 ? services.markets.search(asked) : undefined;
  const searching = asked.length >= 2 && !found;
  const local = allMarkets.filter((item) => {
    const searchable =
      `${item.title} ${item.shortTitle} ${item.category} ${venueName(item.venueId)} ${item.venueContractId}`.toLowerCase();
    return searchTerms.every((term) => searchable.includes(term));
  });
  // A take is on a market still trading: settled ones aren't offered.
  const matchingMarkets = [
    ...local,
    ...(found?.markets ?? []).filter((m) => !local.some((l) => l.id === m.id)),
  ]
    .filter((item) => item.status === "open")
    .slice(0, 50);
  const [picking, setPicking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [text, setText] = useState(initialText);
  const [confidence, setConfidence] = useState<Confidence>("Medium");
  const [audience, setAudience] = useState(initialAudience);
  const [disclose, setDisclose] = useState(true);
  const [options, setOptions] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [draftView, setDraftView] = useState(false);
  const [drafts, setDrafts] = useState<PredictionDraft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [published, setPublished] = useState<Post | null>(null);
  const inputId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const market = services.markets.get(selected);
  const rooms = state.rooms.filter((room) => room.members.includes("you"));
  const holding = state.positions
    .filter(
      (position) =>
        position.marketId === selected && position.outcome === outcome,
    )
    .reduce((total, position) => total + position.shares, 0);
  const length = text.trim().length;
  const validReasoning = length > 0 && length <= MAX_REASONING;
  const valid = validReasoning && !!market;
  const reset = () => {
    setSelected(marketId || "");
    setMarketQuery("");
    setText("");
    setError("");
    setNotice("");
    setPublished(null);
    setPicking(false);
    setOptions(false);
    setEmoji(false);
    setDraftView(false);
    setDraftId(null);
  };
  const saveDraft = () => {
    try {
      const draft: PredictionDraft = {
        id: draftId || crypto.randomUUID(),
        marketId: selected,
        outcome,
        text,
        confidence,
        audience,
        disclosePosition: disclose,
      };
      const next = [
        draft,
        ...readDrafts().filter((item) => item.id !== draft.id),
      ].slice(0, 5);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setDrafts(next);
      setDraftId(draft.id);
      setNotice("Draft saved");
      setError("");
    } catch {
      setError("Couldn't save this draft. Your text is still here; try again.");
    }
  };
  const showDrafts = () => {
    try {
      setDrafts(readDrafts());
      setDraftView(true);
      setError("");
    } catch {
      setError("Couldn't load your drafts. You can keep writing here.");
    }
  };
  const publish = async () => {
    if (!market) {
      setError("Add a market to your prediction first.");
      return;
    }
    try {
      const post = await services.social.createPost({
        marketId: selected,
        outcome,
        text,
        confidence,
        disclosePosition: disclose,
        audience,
      });
      setPublished(post);
      setError("");
      if (draftId) {
        try {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify(
              readDrafts().filter((draft) => draft.id !== draftId),
            ),
          );
        } catch {
          /* Publishing succeeded even if draft storage is unavailable. */
        }
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          if (published) reset();
          setDraftView(false);
          setEmoji(false);
        }
        onOpenChange(value);
      }}
      title="Share your take"
      description="Choose a market, make your call, and share your reasoning."
      className={composer.dialog}
    >
      {!published && (
        <button
          className={composer.draftsButton}
          onClick={draftView ? () => setDraftView(false) : showDrafts}
        >
          {draftView ? "Back to prediction" : "Drafts"}
        </button>
      )}
      {published ? (
        <div className={composer.done} role="status">
          <div className={composer.doneHead}>
            <span>
              <Check size={18} />
            </span>
            <strong>Prediction published</strong>
          </div>
          <article className={composer.preview}>
            <span>
              <b>You</b> · just now · {published.confidence.toLowerCase()}{" "}
              confidence
            </span>
            <p>{published.text}</p>
            <span className={composer.previewMarket}>
              <b>{market?.shortTitle}</b> · Predicts {published.outcome}
            </span>
          </article>
          <div className={composer.doneActions}>
            <Link
              href={`/post/${published.id}`}
              className="button primary"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              View prediction <ArrowRight size={15} />
            </Link>
            <Button onClick={reset}>Write another</Button>
          </div>
        </div>
      ) : draftView ? (
        <div className={composer.drafts}>
          <h2>Drafts</h2>
          {text.trim() && (
            <Button onClick={saveDraft}>Save current draft</Button>
          )}
          {!drafts.length && (
            <p className={composer.emptyDrafts}>
              Your saved predictions will appear here. Save a draft to come back
              to it later.
            </p>
          )}
          {drafts.map((draft) => (
            <div className={composer.draftRow} key={draft.id}>
              <button
                className={composer.restoreDraft}
                onClick={() => {
                  if (draft.marketId && !services.markets.get(draft.marketId)) {
                    setError(
                      "This draft’s market is unavailable. Search for another market to attach.",
                    );
                    setSelected("");
                  } else {
                    setSelected(draft.marketId);
                    setError("");
                  }
                  setText(draft.text);
                  setOutcome(draft.outcome);
                  setConfidence(draft.confidence);
                  setAudience(
                    draft.audience === "public" ||
                      rooms.some((room) => room.id === draft.audience)
                      ? draft.audience
                      : "public",
                  );
                  setDisclose(draft.disclosePosition);
                  setDraftId(draft.id);
                  setDraftView(false);
                  setNotice("");
                }}
              >
                <strong>
                  {services.markets.get(draft.marketId)?.shortTitle ||
                    "Prediction draft"}
                </strong>
                <span>{draft.text}</span>
              </button>
              <button
                className={composer.tool}
                aria-label="Delete draft"
                onClick={() => {
                  try {
                    const next = readDrafts().filter(
                      (item) => item.id !== draft.id,
                    );
                    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
                    setDrafts(next);
                    if (draftId === draft.id) setDraftId(null);
                  } catch {
                    setError("Couldn't delete this draft. Try again.");
                  }
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          {notice && (
            <p role="status" className={composer.notice}>
              {notice}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <form
          className={composer.form}
          onSubmit={(event) => {
            event.preventDefault();
            publish();
          }}
        >
          <div className={composer.writingRow}>
            <Avatar trader={services.profiles.get("you")!} size={40} />
            <div className={composer.editor}>
              <div className={composer.audience}>
                <label className="sr-only" htmlFor={`${inputId}-audience`}>
                  Post to
                </label>
                <select
                  id={`${inputId}-audience`}
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                >
                  <option value="public">Everyone</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </div>
              <label className="sr-only" htmlFor={inputId}>
                Reasoning
              </label>
              <textarea
                id={inputId}
                ref={textarea}
                autoFocus
                rows={5}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setNotice("");
                }}
                maxLength={MAX_REASONING}
                aria-describedby={`${inputId}-hint`}
                placeholder="What’s your take?"
                required
              />
            </div>
          </div>
          {picking ? (
            <div className={composer.marketPicker}>
              <div className={composer.marketSearch}>
                <Search size={17} aria-hidden="true" />
                <label className="sr-only" htmlFor={`${inputId}-market-search`}>
                  Search existing markets
                </label>
                <input
                  id={`${inputId}-market-search`}
                  type="search"
                  autoFocus
                  autoComplete="off"
                  placeholder="Search markets, topics, or venues"
                  value={marketQuery}
                  onChange={(event) => setMarketQuery(event.target.value)}
                />
                <button
                  type="button"
                  className={composer.removeMarket}
                  aria-label="Close market search"
                  onClick={() => setPicking(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div
                className={composer.marketResults}
                role="group"
                aria-label="Market search results"
              >
                {matchingMarkets.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={composer.marketResult}
                    onClick={() => {
                      setSelected(item.id);
                      setPicking(false);
                      setError("");
                    }}
                  >
                    <span className={composer.resultIcon} aria-hidden="true">
                      <CategoryIcon category={item.category} size={16} />
                      <VenueBadge venueId={item.venueId} className={composer.resultVenue} />
                    </span>
                    <span className={composer.resultIdentity}>
                      <strong>{item.title}</strong>
                      <small>
                        {venueName(item.venueId)} · {item.category} · {compactUsd(item.volumeCents)} vol
                      </small>
                    </span>
                    <span className={composer.resultPrice}>
                      <b>{item.yesPrice}¢</b>
                      <small>Yes</small>
                    </span>
                    <span className={composer.resultAdd} aria-hidden="true">
                      <Plus size={14} />
                    </span>
                  </button>
                ))}
                {!matchingMarkets.length &&
                  (searching ? (
                    <div className={composer.noMarkets} role="status">
                      <span>Searching every market…</span>
                    </div>
                  ) : (
                    <div className={composer.noMarkets} role="status">
                      <strong>No matching markets</strong>
                      <span>Try another topic, keyword, or venue.</span>
                      <button type="button" onClick={() => setMarketQuery("")}>
                        Show all markets
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ) : market ? (
            <div className={composer.attachment}>
              <div className={composer.market}>
                <span className={composer.marketMark}>
                  <ChartNoAxesCombined size={18} aria-hidden="true" />
                </span>
                <span>
                  <b>{market.shortTitle}</b>
                  <small>
                    {venueName(market.venueId)} · Yes {priceFor(market, "Yes")}¢
                    · No {priceFor(market, "No")}¢
                  </small>
                </span>
                <button
                  type="button"
                  className={composer.changeMarket}
                  onClick={() => {
                    setMarketQuery("");
                    setPicking(true);
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  className={composer.removeMarket}
                  aria-label="Remove attached market"
                  onClick={() => setSelected("")}
                >
                  <X size={16} />
                </button>
              </div>
              <div
                className={composer.callRow}
                role="group"
                aria-label="Your call"
              >
                <span>Your call</span>
                {(["Yes", "No"] as const).map((side) => (
                  <button
                    type="button"
                    key={side}
                    className={`${composer.side} ${composer[side.toLowerCase()]}`}
                    aria-pressed={outcome === side}
                    onClick={() => setOutcome(side)}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={composer.addMarket}
              aria-label="Choose a market"
              onClick={() => {
                setMarketQuery("");
                setPicking(true);
              }}
            >
              <Search size={16} aria-hidden="true" />
              Choose a market<span>Search existing markets</span>
            </button>
          )}
          {options && (
            <div className={composer.options}>
              <fieldset>
                <legend>Confidence</legend>
                <Segmented
                  values={confidences}
                  value={confidence}
                  onChange={setConfidence}
                  label="Confidence"
                />
              </fieldset>
              <label className={composer.disclose}>
                <input
                  type="checkbox"
                  checked={disclose}
                  onChange={(event) => setDisclose(event.target.checked)}
                />
                <span>
                  Disclose my position
                  <small>
                    {holding
                      ? `${holding.toLocaleString()} ${outcome} shares`
                      : "No shares held · prediction only"}
                  </small>
                </span>
              </label>
            </div>
          )}
          <div className={composer.visibility}>
            {audience === "public" ? <Globe2 size={15} /> : <Users size={15} />}
            {audience === "public"
              ? "Public prediction"
              : "Shared with your room"}
          </div>
          <div className={composer.feedback}>
            <span
              id={`${inputId}-hint`}
              className={length > 0 && !validReasoning ? "negative" : "sr-only"}
            >
              {length > MAX_REASONING
                ? `Keep it to ${MAX_REASONING} characters (${length} so far).`
                : "Explain your call and what would change your mind."}
            </span>
            {notice && (
              <span className={composer.notice} role="status">
                {notice}
              </span>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className={composer.actions}>
            <div className={composer.tools}>
              <button
                type="button"
                className={composer.tool}
                aria-label="Choose market"
                title="Choose market"
                aria-expanded={picking}
                onClick={() => {
                  setMarketQuery("");
                  setPicking(!picking);
                }}
              >
                <ChartNoAxesCombined size={20} />
              </button>
              <div className={composer.emojiWrap}>
                <button
                  type="button"
                  className={composer.tool}
                  aria-label="Add emoji"
                  title="Add emoji"
                  aria-expanded={emoji}
                  onClick={() => setEmoji(!emoji)}
                >
                  <Smile size={20} />
                </button>
                {emoji && (
                  <div
                    className={composer.emojiPicker}
                    role="group"
                    aria-label="Emojis"
                  >
                    {[
                      ["💡", "Idea"],
                      ["📈", "Rising chart"],
                      ["📉", "Falling chart"],
                      ["🎯", "Target"],
                      ["👀", "Eyes"],
                      ["🤔", "Thinking"],
                    ].map(([symbol, label]) => (
                      <button
                        type="button"
                        key={label}
                        aria-label={label}
                        onClick={() => {
                          const start =
                            textarea.current?.selectionStart ?? text.length;
                          const end = textarea.current?.selectionEnd ?? start;
                          setText(
                            (
                              text.slice(0, start) +
                              symbol +
                              text.slice(end)
                            ).slice(0, MAX_REASONING),
                          );
                          setEmoji(false);
                          textarea.current?.focus();
                        }}
                      >
                        {symbol}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={composer.tool}
                aria-label="Prediction settings"
                title="Prediction settings"
                aria-expanded={options}
                onClick={() => setOptions(!options)}
              >
                <SlidersHorizontal size={20} />
              </button>
              <button
                type="button"
                className={composer.tool}
                aria-label="Save draft"
                title="Save draft"
                disabled={!text.trim()}
                onClick={saveDraft}
              >
                <NotebookPen size={20} />
              </button>
            </div>
            <span
              className={composer.counter}
              aria-label={`${length} of ${MAX_REASONING} characters`}
            >
              {length}/{MAX_REASONING}
            </span>
            <button
              type="submit"
              className={composer.postButton}
              disabled={!valid}
            >
              Post
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
