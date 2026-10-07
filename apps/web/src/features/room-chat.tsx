"use client";
/* A room channel's conversation, drawn the way team chat draws it: rows
   with the avatar, the name, the author's position and the time, then the
   message; threads under the messages that started them; joins as system
   lines; and a composer box with a toolbar. */
import Link from "next/link";
import { complement } from "@imo/core/market";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  Channel,
  Market,
  Outcome,
  Post,
  Room,
  RoomMessage,
  Trader,
} from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import {
  clockTime,
  dayAndTime,
  dayLabel,
  readKey,
  roomPredictions,
  sameGroup,
} from "@imo/domain/rooms";
import {
  ArrowUp,
  At,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Hash,
  Link2,
  Smile,
  WarningCircle,
  X,
} from "@/components/icons";
import { Avatar } from "@/components/ui";
import { statusLine } from "./discover-model";
import { JoinButton, MarketPicker } from "./room-parts";
import styles from "./room-chat.module.css";
import { venueName } from "@/data/venues";

/** A message you tried to send while offline (10.5). Kept on the page. */
export type Unsent = {
  id: string;
  text: string;
  marketId?: string;
  channel: string;
  /** Set on a reply that didn't go out. */
  parentId?: string;
  at: string;
};

type Line = {
  id: string;
  authorId: string;
  at: string;
  text: string;
  marketId?: string;
  kind?: "join";
  with?: string[];
  /** Set on a message that couldn't be sent (10.5). */
  failed?: Unsent;
  /** #predictions: the prediction this row opens. */
  post?: Post;
  holding?: RoomMessage["holding"];
};
type Group = { kind: "group"; key: string; authorId: string; lines: Line[] };
type Entry =
  | { kind: "new"; key: string }
  | { kind: "join"; key: string; line: Line }
  | Group;
type Day = { key: string; label: string; entries: Entry[] };
type Side = { text: string; outcome: Outcome } | null;

/** A channel, or a thread in it (`all` lists the channel's threads). */
export const threadHref = (room: Room, channel: string, thread?: string) =>
  `/rooms/${room.id}?channel=${channel}${thread ? `&thread=${thread}` : ""}`;

const byTime = (a: { at: string }, b: { at: string }) =>
  Date.parse(a.at) - Date.parse(b.at);

const fromUnsent = (m: Unsent): Line => ({
  id: m.id,
  authorId: "you",
  at: m.at,
  text: m.text,
  marketId: m.marketId,
  failed: m,
});

const replyCount = (n: number) => `${n} ${n === 1 ? "reply" : "replies"}`;

/** A topic as the end of a sentence: one full stop, never two. */
const sentence = (text: string) =>
  /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** Messages in a channel that have replies, the latest reply first. */
export function channelThreads(room: Room, channel: string) {
  return room.messages
    .filter((m) => m.channel === channel && !m.parentId && !m.kind)
    .map((root) => ({
      root,
      replies: room.messages
        .filter((r) => r.parentId === root.id)
        .toSorted(byTime),
    }))
    .filter((t) => t.replies.length > 0)
    .toSorted((a, b) => byTime(b.replies.at(-1)!, a.replies.at(-1)!));
}

/** Days, the "New" line, joins, then runs of one author's messages a few
    minutes apart. A message that started a thread closes its run: the
    thread hangs under it. */
function arrange(
  lines: Line[],
  since: number,
  now: number,
  threaded: (id: string) => boolean,
): Day[] {
  const days: Day[] = [];
  let group: Group | null = null;
  let marked = false;
  for (const line of lines) {
    const label = dayLabel(line.at, now);
    let day = days.at(-1);
    if (!day || day.label !== label) {
      day = { key: `day-${line.id}`, label, entries: [] };
      days.push(day);
      group = null;
    }
    if (
      !marked &&
      line.authorId !== "you" &&
      !line.failed &&
      !line.kind &&
      Date.parse(line.at) > since
    ) {
      marked = true;
      group = null;
      day.entries.push({ kind: "new", key: "new" });
    }
    if (line.kind === "join") {
      group = null;
      day.entries.push({ kind: "join", key: line.id, line });
      continue;
    }
    const last = group?.lines.at(-1);
    if (
      group &&
      last &&
      !line.failed &&
      !last.failed &&
      !threaded(last.id) &&
      !threaded(line.id) &&
      sameGroup(last, line)
    )
      group.lines.push(line);
    else {
      group = {
        kind: "group",
        key: line.id,
        authorId: line.authorId,
        lines: [line],
      };
      day.entries.push(group);
    }
  }
  return days;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "@Mira Kaplan" in a message becomes a link to their profile; a mention
    of you is marked so the row can say so. */
function useMentions() {
  const { services } = useDemo();
  const people = services.profiles.list();
  const you = services.profiles.get("you");
  const pattern = useMemo(
    () =>
      people.length
        ? new RegExp(
            `@(${people
              .map((t) => t.name)
              .toSorted((a, b) => b.length - a.length)
              .map(escape)
              .join("|")})`,
            "g",
          )
        : null,
    [people],
  );
  return {
    render(text: string): ReactNode[] {
      if (!pattern) return [text];
      const parts: ReactNode[] = [];
      let from = 0;
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        const person = people.find((t) => t.name === match[1]);
        if (!person) continue;
        if (index > from) parts.push(text.slice(from, index));
        parts.push(
          <Link
            key={index}
            href={`/trader/${person.id}`}
            className={styles.mention}
            data-you={person.id === "you" || undefined}
          >
            @{person.name}
          </Link>,
        );
        from = index + match[0].length;
      }
      if (from < text.length) parts.push(text.slice(from));
      return parts;
    },
    mentionsYou: (text: string) => !!you && text.includes(`@${you.name}`),
  };
}

/** What the author holds: the server says, per message. A line of yours it
    hasn't seen yet (just sent, or unsent) uses your own positions. */
function useHolding() {
  const { state } = useDemo();
  return (line: Line, marketId: string | undefined) => {
    if (line.holding !== undefined) return line.holding;
    if (!marketId || line.authorId !== "you") return null;
    const p = state.positions.find((p) => p.marketId === marketId);
    return p ? { outcome: p.outcome, shares: p.shares } : null;
  };
}

/** The side a message's author holds, as 09.1 shows it by their name. */
function useSide(room: Room, channel: Channel | undefined) {
  const holdingOf = useHolding();
  return (line: Line): Side => {
    if (line.post)
      return {
        text: `Predicts ${line.post.outcome}`,
        outcome: line.post.outcome,
      };
    if (!room.disclosure) return null;
    const held = holdingOf(line, line.marketId ?? channel?.marketId);
    return held
      ? {
          text: `${held.outcome} ${held.shares.toLocaleString("en-US")}`,
          outcome: held.outcome,
        }
      : null;
  };
}

/** A linked market: a slim quote with each side a tap away. */
function Embed({ market }: { market: Market }) {
  const no = complement(market.yesPrice);
  return (
    <div className={styles.embed}>
      <Link href={`/market/${market.id}`} className={styles.embedTitle}>
        <b>{market.shortTitle}</b>
        <span>
          {venueName(market.venueId)} · {statusLine(market)}
        </span>
      </Link>
      {market.status === "open" && (
        <span className={styles.embedSides}>
          <Link
            href={`/market/${market.id}?outcome=Yes`}
            data-side="Yes"
            aria-label={`Yes on ${market.shortTitle} at ${market.yesPrice}¢`}
          >
            Yes {market.yesPrice}¢
          </Link>
          <Link
            href={`/market/${market.id}?outcome=No`}
            data-side="No"
            aria-label={`No on ${market.shortTitle} at ${no}¢`}
          >
            No {no}¢
          </Link>
        </span>
      )}
    </div>
  );
}

/**
 * One message. The first of a run carries the avatar, name, side and
 * time; the rest sit under it and show their time in the gutter on hover.
 */
function Row({
  line,
  author,
  lead,
  side,
  replyHref,
  thread,
  onRetry,
  small = false,
}: {
  line: Line;
  author: Trader;
  lead: boolean;
  side: Side;
  /** The thread panel's narrower rows. */
  small?: boolean;
  /** "Reply in thread" goes here; none inside a thread. */
  replyHref?: string;
  /** The thread under this message: who replied, and a way in. */
  thread?: ReactNode;
  onRetry?: (message: Unsent) => void;
}) {
  const { services } = useDemo();
  const mentions = useMentions();
  const market = line.marketId
    ? services.markets.get(line.marketId)
    : undefined;
  return (
    <article
      className={`${styles.row} rise`}
      // A tap on a touch screen focuses the row, which shows its actions.
      tabIndex={replyHref ? -1 : undefined}
      data-lead={lead || undefined}
      data-mine={line.authorId === "you" || undefined}
      data-mentioned={mentions.mentionsYou(line.text) || undefined}
      data-threaded={thread ? true : undefined}
      data-failed={line.failed ? true : undefined}
    >
      <div className={styles.gutter}>
        {lead ? (
          <Link
            href={`/trader/${author.id}`}
            className={styles.avatar}
            tabIndex={-1}
            aria-hidden="true"
          >
            <Avatar trader={author} size={small ? 32 : 36} />
          </Link>
        ) : (
          <time
            className={styles.gutterTime}
            dateTime={line.at}
            aria-hidden="true"
          >
            {clockTime(line.at)}
          </time>
        )}
      </div>
      <div className={styles.body}>
        {lead ? (
          <header className={styles.meta}>
            <Link href={`/trader/${author.id}`} className={styles.name}>
              {author.name}
            </Link>
            {side && (
              <span className={styles.side} data-side={side.outcome}>
                {side.text}
              </span>
            )}
            <time dateTime={line.at}>{clockTime(line.at)}</time>
          </header>
        ) : (
          <span className="sr-only">
            {author.name}, {clockTime(line.at)}:{" "}
          </span>
        )}
        <p className={styles.text}>{mentions.render(line.text)}</p>
        {market && <Embed market={market} />}
        {line.post && (
          <Link href={`/post/${line.post.id}`} className={styles.readMore}>
            Read the prediction
          </Link>
        )}
        {thread}
        {line.failed && onRetry && (
          <span className={styles.failed} role="alert">
            <WarningCircle size={14} />
            Not sent ·{" "}
            <button type="button" onClick={() => onRetry(line.failed!)}>
              Retry
            </button>
          </span>
        )}
      </div>
      {replyHref && (
        <div className={styles.actions}>
          <Link
            href={replyHref}
            scroll={false}
            className={styles.action}
            aria-label={`Reply in thread to ${author.name}`}
            data-tip="Reply in thread"
          >
            <ChatCircle size={16} />
          </Link>
        </div>
      )}
    </article>
  );
}

/** Under a message that started a thread: who replied, how many, when. */
function ThreadSummary({
  replies,
  href,
  now,
}: {
  replies: { authorId: string; at: string }[];
  href: string;
  now: number;
}) {
  const { services } = useDemo();
  const people = [...new Set(replies.map((r) => r.authorId))]
    .map((id) => services.profiles.get(id))
    .filter((t): t is Trader => !!t)
    .slice(0, 3);
  return (
    <Link href={href} scroll={false} className={styles.threadCard}>
      <span className={styles.stack} aria-hidden="true">
        {people.map((t) => (
          <Avatar key={t.id} trader={t} size={20} />
        ))}
      </span>
      <b>{replyCount(replies.length)}</b>
      <span className={styles.swap}>
        <span className={styles.lastReply}>
          Last reply {dayAndTime(replies.at(-1)!.at, now)}
        </span>
        <span className={styles.view} aria-hidden="true">
          View thread
          <CaretRight size={11} />
        </span>
      </span>
    </Link>
  );
}

/** Someone joined: say who, and let members wave hello. */
function JoinLine({
  room,
  channel,
  line,
}: {
  room: Room;
  channel: Channel;
  line: Line;
}) {
  const { services } = useDemo();
  const joiner = services.profiles.get(line.authorId);
  if (!joiner) return null;
  const others = (line.with ?? [])
    .map((id) => services.profiles.get(id))
    .filter((t): t is Trader => !!t);
  const wave = `👋 @${joiner.name}`;
  const waved = room.messages.some(
    (m) =>
      m.authorId === "you" &&
      m.channel === channel.id &&
      byTime(m, line) >= 0 &&
      m.text.startsWith(wave),
  );
  const canWave = room.members.includes("you") && joiner.id !== "you" && !waved;
  return (
    <article className={styles.row} data-lead>
      <div className={styles.gutter}>
        <Link
          href={`/trader/${joiner.id}`}
          className={styles.avatar}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Avatar trader={joiner} size={36} />
        </Link>
      </div>
      <div className={styles.body}>
        <header className={styles.meta}>
          <Link href={`/trader/${joiner.id}`} className={styles.name}>
            {joiner.name}
          </Link>
          <time dateTime={line.at}>{clockTime(line.at)}</time>
        </header>
        <p className={styles.system}>
          joined <b>#{channel.id}</b>
          {others.length > 0 && (
            <>
              {" "}
              along with{" "}
              {others.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && (i === others.length - 1 ? " and " : ", ")}
                  <b>{t.name}</b>
                </span>
              ))}
            </>
          )}
          .
        </p>
        {canWave && (
          <button
            type="button"
            className={styles.wave}
            onClick={() =>
              services.social.roomMessage(room.id, wave, channel.id)
            }
          >
            <span aria-hidden="true">👋</span>
            Wave to say hi
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * A channel's conversation: the channel's start at the top, newest last
 * by the composer, a "New" line where you left off, threads and joins in
 * their places.
 */
export function Conversation({
  room,
  channel,
  unsent = [],
  onRetry,
  predictions = false,
}: {
  room: Room;
  channel: Channel;
  unsent?: Unsent[];
  onRetry?: (message: Unsent) => void;
  /** #predictions: the room's calls, each with its side and market. */
  predictions?: boolean;
}) {
  const { services, state } = useDemo();
  const sideOf = useSide(room, channel);
  const scroller = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const [away, setAway] = useState(false);
  // Where you left off, read once on arrival: the "New" line sits there.
  const [since] = useState(() => {
    const read = Date.parse(
      state.channelReads[readKey(room.id, channel.id)] ?? "",
    );
    return Number.isNaN(read) ? Infinity : read;
  });
  const [now] = useState(() => Date.now());
  const member = room.members.includes("you");
  const lines: Line[] = (
    predictions
      ? roomPredictions(room, state.posts).map((p) => ({
          id: p.id,
          authorId: p.authorId,
          at: p.at,
          text: p.text,
          marketId: p.marketId,
          post: p,
        }))
      : [
          ...room.messages.filter(
            (m) => m.channel === channel.id && !m.parentId,
          ),
          ...unsent.filter((m) => !m.parentId).map(fromUnsent),
        ]
  ).toSorted(byTime);
  const repliesTo = (id: string) =>
    room.messages.filter((m) => m.parentId === id).toSorted(byTime);
  const threaded = (id: string) =>
    !predictions && room.messages.some((m) => m.parentId === id);
  const days = arrange(lines, since, now, threaded);
  const count = lines.length;
  const mineLast = lines.at(-1)?.authorId === "you";
  const channelMarket =
    !predictions && channel.marketId
      ? services.markets.get(channel.marketId)
      : undefined;
  // Arrive at the first new message, or at the latest.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (divider.current) divider.current.scrollIntoView({ block: "center" });
    else el.scrollTop = el.scrollHeight;
  }, []);
  // Follow the conversation when you're at the bottom or just sent one.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && (bottom.current || mineLast)) el.scrollTop = el.scrollHeight;
  }, [count, mineLast]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    bottom.current = at;
    setAway(!at);
  };
  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className={styles.chat}>
      <div
        ref={scroller}
        className={styles.scroller}
        role="log"
        aria-label={
          predictions ? "Room predictions" : `Messages in #${channel.id}`
        }
        onScroll={onScroll}
      >
        <div className={styles.stream}>
          <div className={styles.intro}>
            <span className={styles.introMark} aria-hidden="true">
              <Hash size={22} />
            </span>
            <p className={styles.introTitle}>#{channel.id}</p>
            <p className={styles.introText}>
              {predictions
                ? `Every prediction posted to ${room.name} or made on its markets lands here, with the side it takes.`
                : `This is the start of #${channel.id} in ${room.name}. ${sentence(channel.topic)}`}
            </p>
            {channelMarket && <Embed market={channelMarket} />}
          </div>
          {!lines.length && (
            <p className={styles.empty}>
              {predictions
                ? "No predictions on this room’s markets yet."
                : "No messages yet. Say what you’re watching."}
            </p>
          )}
          {days.map((day) => (
            <div key={day.key} className={styles.daySection}>
              <div
                className={styles.dayRule}
                role="separator"
                aria-label={day.label}
              />
              <span className={styles.dayPill} aria-hidden="true">
                {day.label}
              </span>
              {day.entries.map((entry) => {
                if (entry.kind === "new")
                  return (
                    <div
                      key={entry.key}
                      ref={divider}
                      className={styles.newLine}
                      role="separator"
                      aria-label="New messages"
                    >
                      <span aria-hidden="true">New</span>
                    </div>
                  );
                if (entry.kind === "join")
                  return (
                    <JoinLine
                      key={entry.key}
                      room={room}
                      channel={channel}
                      line={entry.line}
                    />
                  );
                const author = services.profiles.get(entry.authorId);
                if (!author) return null;
                const first = entry.lines[0];
                const replies = threaded(first.id) ? repliesTo(first.id) : [];
                return (
                  <div key={entry.key} className={styles.group}>
                    {replies.length > 0 && (
                      <p className={styles.threadStart}>
                        <Hash size={12} />
                        <span>
                          <b>Thread</b> · {author.name} started a thread
                        </span>
                      </p>
                    )}
                    {entry.lines.map((line, i) => (
                      <Row
                        key={line.id}
                        line={line}
                        author={author}
                        lead={i === 0}
                        side={i === 0 ? sideOf(line) : null}
                        replyHref={
                          member && !line.post && !line.failed
                            ? threadHref(room, channel.id, line.id)
                            : undefined
                        }
                        thread={
                          i === 0 && replies.length > 0 ? (
                            <ThreadSummary
                              replies={replies}
                              href={threadHref(room, channel.id, line.id)}
                              now={now}
                            />
                          ) : undefined
                        }
                        onRetry={onRetry}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {away && (
        <button
          type="button"
          className={styles.jump}
          onClick={jump}
          aria-label="Jump to the latest message"
        >
          <CaretDown size={18} />
        </button>
      )}
    </div>
  );
}

/** A side panel's frame: title, channel, and a way out. Escape closes it
    and hands focus back to where it was opened from. */
function Panel({
  label,
  title,
  channel,
  closeHref,
  compact,
  children,
}: {
  label: string;
  title: string;
  channel: string;
  closeHref: string;
  compact: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [opener] = useState(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body))
        opener.focus({ preventScroll: true });
    },
    [opener],
  );
  return (
    <section
      className={styles.panel}
      aria-label={label}
      data-compact={compact || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        router.replace(closeHref, { scroll: false });
      }}
    >
      <header className={styles.panelHead}>
        {compact && (
          <Link
            href={closeHref}
            scroll={false}
            className={styles.close}
            aria-label={`Back to #${channel}`}
          >
            <CaretLeft size={18} />
          </Link>
        )}
        <span className={styles.panelTitle}>
          <b>{title}</b>
          <span>#{channel}</span>
        </span>
        {!compact && (
          <Link
            href={closeHref}
            scroll={false}
            className={styles.close}
            aria-label={`Close ${title.toLowerCase()}`}
          >
            <X size={16} />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** The thread under one message: the message, its replies, a reply box. */
export function ThreadPanel({
  room,
  rootId,
  closeHref,
  unsent = [],
  onSend,
  onRetry,
  compact = false,
}: {
  room: Room;
  rootId: string;
  closeHref: string;
  unsent?: Unsent[];
  onSend: (text: string, marketId?: string) => void;
  onRetry?: (message: Unsent) => void;
  compact?: boolean;
}) {
  const { services } = useDemo();
  const root = room.messages.find(
    (m) => m.id === rootId && !m.parentId && !m.kind,
  );
  const channel = room.channels.find((c) => c.id === root?.channel);
  const sideOf = useSide(room, channel);
  const replies: Line[] = [
    ...room.messages.filter((m) => m.parentId === rootId),
    ...unsent.filter((m) => m.parentId === rootId).map(fromUnsent),
  ].toSorted(byTime);
  const list = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const count = replies.length;
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  const author = root && services.profiles.get(root.authorId);
  if (!root || !channel || !author)
    return (
      <Panel
        label="Thread"
        title="Thread"
        channel={channel?.id ?? "general"}
        closeHref={closeHref}
        compact={compact}
      >
        <p className={styles.panelNote}>This thread is no longer here.</p>
      </Panel>
    );
  const member = room.members.includes("you");
  return (
    <Panel
      label="Thread"
      title="Thread"
      channel={channel.id}
      closeHref={closeHref}
      compact={compact}
    >
      <div
        ref={list}
        className={styles.panelScroll}
        role="log"
        aria-label={`Thread under ${author.name}’s message`}
      >
        <Row line={root} author={author} lead side={sideOf(root)} small />
        <div
          className={styles.replyRule}
          role="separator"
          aria-label={count ? replyCount(count) : "No replies yet"}
        >
          <span aria-hidden="true">
            {count ? replyCount(count) : "No replies yet"}
          </span>
        </div>
        {replies.map((line, i) => {
          const by = services.profiles.get(line.authorId);
          if (!by) return null;
          const prev = replies[i - 1];
          // A reply on a later day than what it follows says which day.
          const day = dayLabel(line.at, now);
          const newDay = day !== dayLabel((prev ?? root).at, now);
          const lead =
            !prev ||
            newDay ||
            !!prev.failed ||
            !!line.failed ||
            !sameGroup(prev, line);
          return (
            <Fragment key={line.id}>
              {newDay && (
                <div
                  className={styles.replyRule}
                  role="separator"
                  aria-label={day}
                >
                  <span aria-hidden="true">{day}</span>
                </div>
              )}
              <Row
                line={line}
                author={by}
                lead={lead}
                side={lead ? sideOf(line) : null}
                onRetry={onRetry}
                small
              />
            </Fragment>
          );
        })}
      </div>
      {member ? (
        <ChatComposer
          label="Reply to thread"
          placeholder="Reply…"
          members={room.members}
          onSend={onSend}
          compact={compact}
          autoFocus={!compact}
        />
      ) : (
        <p className={styles.panelNote}>Join {room.name} to reply.</p>
      )}
    </Panel>
  );
}

/** Every thread in a channel, the latest reply first. */
export function ThreadsList({
  room,
  channel,
  closeHref,
  compact = false,
}: {
  room: Room;
  channel: Channel;
  closeHref: string;
  compact?: boolean;
}) {
  const { services } = useDemo();
  const [now] = useState(() => Date.now());
  const threads = channelThreads(room, channel.id);
  return (
    <Panel
      label="Threads"
      title="Threads"
      channel={channel.id}
      closeHref={closeHref}
      compact={compact}
    >
      <div className={styles.panelScroll}>
        {threads.length ? (
          <ul className={styles.threads}>
            {threads.map(({ root, replies }) => {
              const author = services.profiles.get(root.authorId);
              if (!author) return null;
              return (
                <li key={root.id}>
                  <Link
                    href={threadHref(room, channel.id, root.id)}
                    scroll={false}
                    className={styles.threadItem}
                  >
                    <Avatar trader={author} size={28} />
                    <span className={styles.threadText}>
                      <b>{author.name}</b>
                      <span className={styles.threadPreview}>{root.text}</span>
                      <span className={styles.threadMeta}>
                        {replyCount(replies.length)} · last reply{" "}
                        {dayAndTime(replies.at(-1)!.at, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.panelNote}>
            No threads in #{channel.id} yet. Hover a message and choose Reply in
            thread to start one.
          </p>
        )}
      </div>
    </Panel>
  );
}

const EMOJI = [
  "👍",
  "🔥",
  "📈",
  "📉",
  "👀",
  "🎯",
  "🤝",
  "😅",
  "💯",
  "🙏",
  "😬",
  "🚀",
];

/** A toolbar popover: its button, and a panel that Escape and outside
    clicks close. Arrow keys move between the choices. */
function Pop({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const move = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const items = [
      ...(panel.current?.querySelectorAll<HTMLElement>("button") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <div className={styles.popRoot} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.tool}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={styles.pop}
          role="dialog"
          aria-label={label}
          onKeyDown={move}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * The composer: a box that grows with the message, and a toolbar to link
 * a market, mention someone, add an emoji and send. On a keyboard, Enter
 * sends and Shift+Enter starts a new line.
 */
export function ChatComposer({
  label,
  placeholder,
  members,
  onSend,
  compact = false,
  autoFocus = false,
}: {
  label: string;
  placeholder: string;
  /** The room's members, for @mentions. */
  members: string[];
  onSend: (text: string, marketId?: string) => void;
  /** Phones: Return adds a line; the send button sends. */
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const { services } = useDemo();
  const [text, setText] = useState("");
  const [linked, setLinked] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const inputId = useId();
  const hintId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const market = linked ? services.markets.get(linked) : undefined;
  const people = members
    .filter((m) => m !== "you")
    .map((m) => services.profiles.get(m))
    .filter((t): t is Trader => !!t);
  useEffect(() => {
    if (autoFocus) area.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  // Grow with the message, up to about eight lines, and re-measure when
  // the column changes width.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 172)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);
  const insert = (value: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const piece =
      value.startsWith("@") && before && !/\s$/.test(before)
        ? ` ${value}`
        : value;
    setText(before + piece + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + piece.length, start + piece.length);
    });
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) return;
    try {
      onSend(text, linked);
      setText("");
      setLinked(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form
      className={styles.composer}
      data-compact={compact || undefined}
      onSubmit={submit}
    >
      <div className={styles.box}>
        {market && (
          <div className={styles.linked}>
            <Link2 size={13} />
            <span>
              Linking <b>{market.shortTitle}</b>
            </span>
            <button
              type="button"
              aria-label={`Unlink ${market.shortTitle}`}
              onClick={() => setLinked(undefined)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <textarea
          ref={area}
          id={inputId}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              !compact &&
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          maxLength={1200}
          autoComplete="off"
          aria-describedby={compact ? undefined : hintId}
        />
        <div className={styles.tools}>
          {!compact && (
            <span
              id={hintId}
              className={styles.hint}
              data-on={text.trim() ? true : undefined}
            >
              <b>Enter</b> to send · <b>Shift + Enter</b> for a new line
            </span>
          )}
          <MarketPicker
            label="Link a market"
            triggerClassName={styles.tool}
            trigger={<Link2 size={17} />}
            selected={linked ? [linked] : []}
            placement="above"
            align="end"
            onPick={(m) => setLinked(m.id === linked ? undefined : m.id)}
          />
          <span className={styles.toolRule} aria-hidden="true" />
          <Pop label="Mention someone" icon={<At size={17} />}>
            {(close) =>
              people.length ? (
                <div className={styles.people}>
                  {people.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        insert(`@${t.name} `);
                        close();
                      }}
                    >
                      <Avatar trader={t} size={22} />
                      {t.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.popEmpty}>No one else here yet.</p>
              )
            }
          </Pop>
          <Pop label="Add an emoji" icon={<Smile size={17} />}>
            {(close) => (
              <div className={styles.emoji}>
                {EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      insert(e);
                      close();
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </Pop>
          <button
            type="submit"
            className={styles.send}
            aria-label="Send message"
            disabled={!text.trim()}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** #predictions: the box opens the prediction composer instead. */
export function FauxComposer({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  return (
    <div className={styles.composer}>
      <button type="button" className={styles.faux} onClick={onOpen}>
        <span>{label}</span>
        <span className={styles.fauxSend} aria-hidden="true">
          <ArrowUp size={16} />
        </span>
      </button>
    </div>
  );
}

/** Not a member yet: where the composer would be, the way in. */
export function JoinBar({ room }: { room: Room }) {
  return (
    <div className={styles.composer}>
      <div className={styles.joinBar}>
        <span>
          You’re reading <b>{room.name}</b>. Join to post.
        </span>
        <JoinButton room={room} />
      </div>
    </div>
  );
}
