"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Channel, Room } from "@imo/domain/types";
import { useDemo, useLive, useLoadingView } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import { accuracy } from "@imo/domain/engine";
import { PREDICTIONS_CHANNEL, lastChannel, unreadIn } from "@imo/domain/rooms";
import {
  Bell,
  CaretDown,
  CaretLeft,
  ChatCircle,
  GearSix,
  Hash,
  Lock,
  Plus,
  Users,
} from "@/components/icons";
import { Avatar, Empty, Modal } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { changeText, changeTone } from "@/components/market-bits";
import { useMediaQuery } from "@/components/use-media-query";
import { Composer } from "./social";
import { MarketPicker, RoomMark } from "./room-parts";
import { ManageRoom, type ManageTab } from "./room-manage";
import {
  ChatComposer,
  Conversation,
  FauxComposer,
  JoinBar,
  ThreadPanel,
  ThreadsList,
  channelThreads,
  threadHref,
  type Unsent,
} from "./room-chat";
import styles from "./room.module.css";

/** Stands in for the channel list an outsider doesn't get. */
const COVER_CHANNEL: Channel = { id: "general", topic: "" };

/**
 * 09.1 · a room: its channels and shared markets on the left, the
 * channel's conversation in the middle, who's online on the right — or,
 * while one is open, a thread.
 * 09.2 · phones and tablets get the conversation, with the channels and
 * members a tap away, and a thread in its place when you open one.
 */
/** The conversation while it loads: messages settle at the bottom, as the
    log does, above the composer. */
function LogLoading() {
  return (
    <div className={styles.loadingLog}>
      {[180, 240, 140, 210].map((w, i) => (
        <div key={i} className={styles.loadingMessage}>
          <Bone circle={34} />
          <div>
            <span className={styles.loadingMeta}>
              <Bone w={w / 2} h={11} />
              <Bone w={34} h={9} />
            </span>
            <BoneLines lines={i % 2 ? 2 : 1} h={11} last={`${(w / 300) * 100}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RoomLoading({ compact }: { compact: boolean }) {
  if (compact)
    return (
      <Loading label="Loading this room" className={styles.phone}>
        <div className={styles.phoneHead}>
          <Bone circle={36} />
          <span className={styles.loadingTitle}>
            <Bone w={120} h={13} />
            <Bone w={180} h={9} />
          </span>
          <Bone circle={36} />
        </div>
        <div className={styles.chips} aria-hidden="true">
          <Bone w={150} h={44} r={12} />
          <Bone w={150} h={44} r={12} />
        </div>
        <div className={styles.phoneBody}>
          <LogLoading />
        </div>
        <div className={styles.loadingComposer}>
          <Bone w="100%" h={44} r={14} />
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading this room" className={styles.room}>
      <div className={styles.sidebar}>
        <span className={styles.identity}>
          <Bone w={32} h={32} r={9} />
          <span className={styles.loadingTitle}>
            <Bone w={96} h={12} />
            <Bone w={58} h={9} />
          </span>
        </span>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Channels</span>
          {[64, 44, 82].map((w) => (
            <span key={w} className={styles.loadingLink}>
              <Bone w={w} h={11} />
            </span>
          ))}
        </div>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Room markets</span>
          {[120, 96].map((w) => (
            <span key={w} className={styles.loadingLink}>
              <Bone w={w} h={11} />
              <Bone w={22} h={11} />
            </span>
          ))}
        </div>
      </div>
      <section className={styles.channel}>
        <div className={styles.channelHead}>
          <Bone w={150} h={9} />
          <div className={styles.titleRow}>
            <Bone w={110} h={20} />
            <Bone w={170} h={11} style={{ marginLeft: 10 }} />
          </div>
        </div>
        <LogLoading />
        <div className={styles.loadingComposer}>
          <Bone w="100%" h={44} r={14} />
        </div>
      </section>
      <aside className={styles.people}>
        <div className={styles.peopleList}>
          <span className={styles.groupLabel}>
            <Bone w={70} h={9} />
          </span>
          {[96, 80, 104, 72, 88].map((w) => (
            <span key={w} className={styles.person}>
              <Bone circle={28} />
              <Bone w={w} h={11} />
            </span>
          ))}
        </div>
      </aside>
    </Loading>
  );
}

export function RoomDetail({ id }: { id: string }) {
  const { services, state } = useDemo();
  const loading = useLoadingView();
  useLive("room", id);
  const params = useSearchParams();
  const compact = useMediaQuery("(max-width: 900px)");
  const room = state.rooms.find((r) => r.id === id);
  const [manage, setManage] = useState<ManageTab | null>(null);
  const [sheet, setSheet] = useState<"channels" | "members" | null>(null);
  const [composer, setComposer] = useState(false);
  const [unsent, setUnsent] = useState<Unsent[]>([]);
  const member = !!room?.members.includes("you");
  const locked = !!room && room.privacy === "Invite only" && !member;
  const asked = params.get("channel");
  const thread = params.get("thread");
  // Outsiders get an invite-only room's cover, and no channels come with it.
  const channel = room
    ? (room.channels.find((c) => c.id === asked) ??
      lastChannel(state, room) ??
      (locked ? COVER_CHANNEL : undefined))
    : undefined;
  const roomId = room?.id;
  const channelId = channel?.id;
  const latest = room?.messages
    .filter((m) => m.channel === channelId)
    .at(-1)?.at;
  // Reading a channel clears its unread count.
  useEffect(() => {
    if (roomId && channelId && member)
      services.social.markChannelRead(roomId, channelId);
  }, [roomId, channelId, member, latest, services]);

  if (loading || (!room && services.pending("room", id))) return <RoomLoading compact={compact} />;
  if (!room || !channel)
    return (
      <Empty
        title="This room isn’t available"
        description="It may have been archived, or the link is mistyped."
        action={
          <Link href="/rooms" className="btn btn-primary">
            Explore rooms
          </Link>
        }
      />
    );

  const send = (text: string, marketId?: string, parentId?: string) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setUnsent((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          text,
          marketId,
          channel: channel.id,
          parentId,
          at: new Date().toISOString(),
        },
      ]);
      return;
    }
    services.social.roomMessage(room.id, text, channel.id, marketId, parentId);
  };
  const retry = (message: Unsent) => {
    if (navigator.onLine === false) return;
    services.social.roomMessage(
      room.id,
      message.text,
      message.channel,
      message.marketId,
      message.parentId,
    );
    setUnsent((list) => list.filter((m) => m.id !== message.id));
  };
  const predictions = channel.id === PREDICTIONS_CHANNEL;
  const here = threadHref(room, channel.id);
  const threads = predictions ? [] : channelThreads(room, channel.id);
  const threadsHref =
    thread === "all" ? here : threadHref(room, channel.id, "all");
  const threadsLabel = threads.length
    ? `Threads · ${threads.length}`
    : "Threads";
  const panel =
    locked || predictions || !thread ? null : thread === "all" ? (
      <ThreadsList
        room={room}
        channel={channel}
        closeHref={here}
        compact={compact}
      />
    ) : (
      <ThreadPanel
        key={thread}
        room={room}
        rootId={thread}
        closeHref={here}
        unsent={unsent}
        onSend={(text, marketId) => send(text, marketId, thread)}
        onRetry={retry}
        compact={compact}
      />
    );
  const conversation = locked ? (
    <Locked room={room} />
  ) : (
    <Conversation
      key={`log-${channel.id}`}
      room={room}
      channel={channel}
      unsent={unsent.filter((m) => m.channel === channel.id)}
      onRetry={retry}
      predictions={predictions}
    />
  );
  const footer = locked ? null : !member ? (
    <JoinBar room={room} />
  ) : predictions ? (
    <FauxComposer
      label={`Share your take with ${room.name}`}
      onOpen={() => setComposer(true)}
    />
  ) : (
    <ChatComposer
      key={`composer-${channel.id}`}
      label={`Message #${channel.id}`}
      placeholder={`Message #${channel.id}`}
      members={room.members}
      compact={compact}
      onSend={send}
    />
  );
  const membersSheet = (
    <Modal
      open={sheet === "members"}
      onOpenChange={(open) => setSheet(open ? "members" : null)}
      title={`Online · ${room.online}`}
      description={`${room.memberCount.toLocaleString("en-US")} members in ${room.name}`}
    >
      <People room={room} locked={locked} />
      <button
        type="button"
        className={`btn btn-secondary ${styles.sheetAction}`}
        onClick={() => {
          setSheet(null);
          setManage("Members");
        }}
      >
        <GearSix size={15} />
        Room settings
      </button>
    </Modal>
  );
  const dialogs = (
    <>
      {membersSheet}
      <ManageRoom
        room={room}
        tab={manage}
        onTab={setManage}
        onClose={() => setManage(null)}
      />
      <Composer
        key={`${composer}`}
        open={composer}
        onOpenChange={setComposer}
        initialAudience={room.id}
      />
    </>
  );

  if (compact)
    return (
      <div className={styles.phone}>
        <h1 className="sr-only">{room.name}</h1>
        {panel ?? (
          <>
            <header className={styles.phoneHead}>
              <Link
                href="/rooms"
                className={`btn btn-icon ${styles.iconButton}`}
                aria-label="All rooms"
              >
                <CaretLeft size={20} />
              </Link>
              <button
                type="button"
                className={styles.phoneTitle}
                onClick={() => setSheet("channels")}
                aria-label={`${room.name}, #${channel.id} — channels and room markets`}
                disabled={locked}
              >
                <b>{room.name}</b>
                <span>
                  #{channel.id} · {room.online} online ·{" "}
                  {room.memberCount.toLocaleString("en-US")} members
                </span>
              </button>
              {!locked && !predictions && (
                <Link
                  href={threadsHref}
                  scroll={false}
                  className={`btn btn-icon ${styles.iconButton}`}
                  aria-label={threadsLabel}
                >
                  <ChatCircle size={18} />
                </Link>
              )}
              <button
                type="button"
                className={`btn btn-icon ${styles.iconButton}`}
                aria-label="Members"
                onClick={() => setSheet("members")}
              >
                <Users size={18} />
              </button>
            </header>
            {!locked && !!room.watchlist.length && (
              <div
                className={styles.chips}
                aria-label="Room markets"
                role="list"
              >
                {room.watchlist.map((mid) => {
                  const m = services.markets.get(mid)!;
                  return (
                    <Link
                      key={mid}
                      role="listitem"
                      href={`/market/${mid}`}
                      className={styles.chip}
                    >
                      <b>{m.shortTitle}</b>
                      <span>
                        <b>{m.yesPrice}¢</b>
                        <span
                          className={
                            m.status === "open" ? changeTone(m.change) : ""
                          }
                        >
                          {m.status === "open"
                            ? changeText(m.change)
                            : "Settled"}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <div className={styles.phoneBody}>{conversation}</div>
            {footer}
          </>
        )}
        <Modal
          open={sheet === "channels"}
          onOpenChange={(open) => setSheet(open ? "channels" : null)}
          title={room.name}
          description="Channels and the room’s markets"
        >
          <Sidebar
            room={room}
            channel={channel}
            onManage={(tab) => {
              setSheet(null);
              setManage(tab);
            }}
            onNavigate={() => setSheet(null)}
            inSheet
          />
        </Modal>
        {dialogs}
      </div>
    );

  return (
    <div className={styles.room} data-panel={panel ? true : undefined}>
      <h1 className="sr-only">{room.name}</h1>
      <Sidebar room={room} channel={channel} onManage={setManage} />
      <section className={styles.channel} aria-labelledby="channel-name">
        <header className={styles.channelHead}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <ol>
              <li>
                <Link href="/rooms">Rooms</Link>
              </li>
              <li>{room.name}</li>
              {!locked && <li aria-current="page">#{channel.id}</li>}
            </ol>
          </nav>
          <div className={styles.titleRow}>
            <h2 id="channel-name">
              {locked ? (
                <>
                  <Lock size={17} className={styles.hash} />
                  Members only
                </>
              ) : (
                <>
                  <span className={styles.hash}>#</span>
                  {channel.id}
                </>
              )}
            </h2>
            {!locked && <span className={styles.topic}>{channel.topic}</span>}
            <span className={styles.flex} />
            {member && (
              <Menu
                label={`Notifications: ${room.notify}`}
                triggerClassName={`btn btn-ghost btn-icon ${styles.headIcon}`}
                trigger={<Bell size={16} />}
              >
                {(["All messages", "Mentions", "Nothing"] as const).map((n) => (
                  <MenuItem
                    key={n}
                    checked={room.notify === n}
                    onSelect={() =>
                      services.social.updateRoom(room.id, { notify: n })
                    }
                  >
                    {n}
                  </MenuItem>
                ))}
              </Menu>
            )}
            {!locked && (
              <>
                <button
                  type="button"
                  className={`btn btn-ghost btn-icon ${styles.headIcon} ${styles.membersToggle}`}
                  aria-label="Members"
                  onClick={() => setSheet("members")}
                >
                  <Users size={16} />
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost btn-icon ${styles.headIcon}`}
                  aria-label="Room settings"
                  onClick={() => setManage("Members")}
                >
                  <GearSix size={16} />
                </button>
              </>
            )}
            {!locked && !predictions && (
              <Link
                href={threadsHref}
                scroll={false}
                className={styles.threadsButton}
                aria-label={threadsLabel}
                aria-expanded={thread === "all"}
              >
                <Hash size={14} />
                Threads
                {threads.length > 0 && (
                  <span className={styles.threadsCount} aria-hidden="true">
                    {threads.length}
                  </span>
                )}
              </Link>
            )}
          </div>
        </header>
        {conversation}
        {footer}
      </section>
      {panel ?? (
        <aside className={styles.people} aria-label="Online members">
          <People room={room} locked={locked} />
        </aside>
      )}
      {dialogs}
    </div>
  );
}

/** 09.1 left column: the room, its channels, its markets. */
function Sidebar({
  room,
  channel,
  onManage,
  onNavigate,
  inSheet = false,
}: {
  room: Room;
  channel: Channel;
  onManage: (tab: ManageTab) => void;
  onNavigate?: () => void;
  inSheet?: boolean;
}) {
  const { services, state } = useDemo();
  const member = room.members.includes("you");
  const locked = room.privacy === "Invite only" && !member;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/rooms/${room.id}`,
      );
    } catch {
      // Clipboard blocked: the address bar still has it.
    }
  };
  return (
    <nav
      className={styles.sidebar}
      data-sheet={inSheet || undefined}
      aria-label={`${room.name} channels and markets`}
    >
      {!inSheet && (
        <Menu
          label={`${room.name} menu`}
          align="start"
          className={styles.identityMenu}
          triggerClassName={styles.identity}
          trigger={
            <>
              <RoomMark room={room} size={32} />
              <span className={styles.identityText}>
                <b>{room.name}</b>
                <span>{room.online} online</span>
              </span>
              <CaretDown size={13} />
            </>
          }
        >
          {!locked && (
            <MenuItem onSelect={() => onManage("Members")}>
              Room settings
            </MenuItem>
          )}
          <MenuItem onSelect={copy}>Copy invite link</MenuItem>
          {member && room.owner !== "you" && (
            <MenuItem
              tone="negative"
              onSelect={() => services.social.joinRoom(room.id)}
            >
              Leave room
            </MenuItem>
          )}
          {!member && !room.requests.includes("you") && (
            <MenuItem
              onSelect={() =>
                room.privacy === "Public"
                  ? services.social.joinRoom(room.id)
                  : services.social.requestJoin(room.id)
              }
            >
              {room.privacy === "Public" ? "Join room" : "Request to join"}
            </MenuItem>
          )}
        </Menu>
      )}
      {locked ? (
        <p className={styles.sideNote}>
          <Lock size={13} />
          Channels and markets open once you’re in.
        </p>
      ) : (
        <>
          <div className={styles.group}>
            <span className={styles.groupLabel}>Channels</span>
            {room.channels.map((c) => {
              const unread = unreadIn(state, room, c);
              return (
                <Link
                  key={c.id}
                  href={threadHref(room, c.id)}
                  scroll={false}
                  className={styles.channelLink}
                  aria-current={c.id === channel.id ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <span className={styles.hashSmall} aria-hidden="true">
                    #
                  </span>
                  <span className={styles.channelName}>{c.id}</span>
                  {unread > 0 && (
                    <span className={styles.badge}>
                      {unread}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <div className={styles.group}>
            <span className={styles.groupLabel}>
              <span>Room markets</span>
              {member && (
                <MarketPicker
                  label="Add a market to the room"
                  triggerClassName={styles.addMarket}
                  trigger={<Plus size={13} />}
                  selected={room.watchlist}
                  keepOpen
                  align={inSheet ? "end" : "start"}
                  onPick={(m) =>
                    services.social.toggleRoomMarket(room.id, m.id)
                  }
                />
              )}
            </span>
            {room.watchlist.map((mid) => {
              const m = services.markets.get(mid)!;
              return (
                <Link
                  key={mid}
                  href={`/market/${mid}`}
                  className={styles.marketLink}
                >
                  <span>{m.shortTitle}</span>
                  <span className={styles.marketPrice}>{m.yesPrice}¢</span>
                </Link>
              );
            })}
            {!room.watchlist.length && (
              <p className={styles.sideNote}>
                No markets yet. Add one to give the room a focus.
              </p>
            )}
          </div>
          {inSheet && (
            <button
              type="button"
              className={`btn btn-secondary ${styles.sheetAction}`}
              onClick={() => onManage("Members")}
            >
              <GearSix size={15} />
              Room settings
            </button>
          )}
        </>
      )}
    </nav>
  );
}

/** 09.1 right column: who's here, with each one's hit rate. */
function People({ room, locked }: { room: Room; locked: boolean }) {
  const { services } = useDemo();
  if (locked)
    return (
      <p className={styles.sideNote}>
        <Lock size={13} />
        Members are visible once you’re in.
      </p>
    );
  const people = room.members
    .map((m) => services.profiles.get(m))
    .filter((t) => !!t);
  // Seen in the room in the last few minutes, as the server tracks it.
  const here = new Set(room.onlineMembers ?? []);
  const online = people.filter((t) => here.has(t.id));
  const away = people.filter((t) => !here.has(t.id));
  const row = (t: (typeof people)[number], isOnline: boolean) => (
    <Link key={t.id} href={`/trader/${t.id}`} className={styles.person}>
      <span className={styles.personAvatar}>
        <Avatar trader={t} size={28} />
        {isOnline && <i aria-hidden="true" />}
      </span>
      <span className={styles.personName}>
        {t.id === "you" ? `${t.name} (you)` : t.name}
      </span>
      <span className={styles.personAcc}>
        {accuracy(t.stats["30D"])}%<span className="sr-only"> right</span>
      </span>
    </Link>
  );
  return (
    <div className={styles.peopleList}>
      {online.length > 0 && (
        <>
          <span className={styles.groupLabel}>Online · {online.length}</span>
          {online.map((t) => row(t, true))}
        </>
      )}
      {away.length > 0 && (
        <>
          <span className={styles.groupLabel}>Members · {away.length}</span>
          {away.map((t) => row(t, false))}
        </>
      )}
    </div>
  );
}

/** 10.4 · invite only: say who decides, and ask. */
function Locked({ room }: { room: Room }) {
  const { services } = useDemo();
  const owner = services.profiles.get(room.owner);
  const requested = room.requests.includes("you");
  return (
    <div className={styles.lockedWrap}>
      <div className={styles.locked}>
        <Lock size={22} />
        <b>{room.name} is invite only</b>
        <p>
          {requested
            ? `Request sent — ${owner?.name ?? "the owner"} approves new members.`
            : `Request to join — ${owner?.name ?? "the owner"} approves new members.`}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={requested}
          onClick={() => services.social.requestJoin(room.id)}
        >
          {requested ? "Request sent" : "Request to join"}
        </button>
      </div>
    </div>
  );
}
