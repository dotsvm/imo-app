"use client";
/* 10 · Watchlists. 10.1: your lists on the left, the chosen one as a
   table you can reorder, rename, share and prune. 10.2: on a phone the
   lists become chips, and a row swipes left to go. */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Market, Room } from "@imo/domain/types";
import { priceFor } from "@imo/domain/money";
import {
  SAVED_LIST,
  marketCount,
  ownLists,
  sharedLists,
  updatedLabel,
  type ListView,
} from "@imo/domain/watchlists";
import { useDemo, useLoadingView } from "@/services/provider";
import { Bone, Loading } from "@/components/skeleton";
import {
  ArrowUpRight,
  ArrowsLeftRight,
  BookmarkSimple,
  DotsSixVertical,
  DotsThree,
  ListChecks,
  Pencil,
  Plus,
  ShareNetwork,
  Trash2,
  UsersThree,
  X,
} from "@/components/icons";
import { Menu, MenuItem } from "@/components/menu";
import { SignInWall, Modal, closeLabel } from "@/components/ui";
import { Spark, changeText, changeTone } from "@/components/market-bits";
import { useMediaQuery } from "@/components/use-media-query";
import styles from "./watchlists.module.css";
import { venueName } from "@/data/venues";
import { Flash } from "@/components/motion";

type Notice = {
  text: string;
  undo?: () => void;
  link?: { label: string; href: string };
};

const TAG = { saved: "Default", own: "Private", room: "Shared" } as const;

const hrefOf = (id: string) =>
  id === SAVED_LIST
    ? "/watchlist"
    : `/watchlist?list=${encodeURIComponent(id)}`;

const statusOf = (m: Market) =>
  m.status === "open"
    ? "Open"
    : m.status === "closed"
      ? "Awaiting result"
      : `Resolved ${m.resolution.outcome ?? ""}`.trim();

const closes = (m: Market) => closeLabel(m).replace(/^Closes /, "");

export function Watchlists() {
  const { state } = useDemo();
  if (state.signedOut)
    return <SignInWall title="Watch the markets you care about" description="Log in to save markets to lists and share them with your rooms." />;
  return <WatchlistsPage />;
}

const LOADING_LISTS = [104, 128, 86, 116];
const LOADING_MARKETS = [72, 58, 66, 50, 62];

/** Lists on the left, the open list's markets on the right, while they load. */
function WatchlistsLoading({ phone }: { phone: boolean }) {
  if (phone)
    return (
      <Loading label="Loading your watchlists" className={styles.phone}>
        <header className={styles.phoneHead}>
          <h1>Watchlists</h1>
          <Bone circle={36} />
        </header>
        <div className={styles.chips} aria-hidden="true">
          {LOADING_LISTS.map((w) => (
            <Bone key={w} w={w} h={32} r="pill" />
          ))}
        </div>
        <div className={styles.phoneMeta}>
          <Bone w={150} h={10} />
          <Bone circle={30} />
        </div>
        <div className={styles.phoneBody}>
          {LOADING_MARKETS.map((w, i) => (
            <div key={i} className={styles.phoneRow}>
              <Bone w={`${w + 14}%`} h={12} className={styles.phoneTitle} />
              <Bone w={34} h={12} className={styles.phonePrice} />
              <Bone w={110} h={9} className={styles.phoneStatus} />
              <Bone w={30} h={9} className={styles.phoneMove} />
            </div>
          ))}
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading your watchlists" className={styles.page}>
      <div className={styles.rail}>
        <header className={styles.railHead}>
          <h1>Watchlists</h1>
          <Bone w={72} h={32} r="pill" />
        </header>
        <div className={styles.lists}>
          {LOADING_LISTS.map((w) => (
            <span key={w} className={styles.listLink}>
              <Bone w={w} h={12} />
              <Bone w={w + 24} h={9} style={{ marginTop: 6 }} />
            </span>
          ))}
        </div>
      </div>
      <section className={styles.detail}>
        <header className={styles.detailHead}>
          <Bone w={190} h={22} />
          <Bone w={58} h={20} r={6} />
          <span className={styles.flex} />
          <div className={styles.actions}>
            <Bone w={130} h={34} r="pill" />
            <Bone w={100} h={34} r="pill" />
          </div>
        </header>
        <div className={styles.body}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.colLead} />
                <th scope="col">Market</th>
                <th scope="col" className={styles.colSpark}>
                  7d
                </th>
                <th scope="col" className={`${styles.num} ${styles.colYes}`}>
                  Yes
                </th>
                <th scope="col" className={`${styles.num} ${styles.colNo}`}>
                  No
                </th>
                <th scope="col" className={`${styles.num} ${styles.colChange}`}>
                  24h
                </th>
                <th scope="col" className={`${styles.num} ${styles.colCloses}`}>
                  Closes
                </th>
                <th scope="col" className={styles.colTail} />
              </tr>
            </thead>
            <tbody>
              {LOADING_MARKETS.map((w, i) => (
                <tr key={i} aria-hidden="true">
                  <td className={styles.lead}>
                    <Bone w={12} h={14} r={3} />
                  </td>
                  <th scope="row">
                    <span className={styles.market}>
                      <Bone w={`${w}%`} h={12} />
                      <Bone w={150} h={9} style={{ marginTop: 6 }} />
                    </span>
                  </th>
                  <td className={`${styles.sparkCell} ${styles.colSpark}`}>
                    <Bone w={64} h={20} r={4} />
                  </td>
                  {[28, 28, 30, 44].map((cw, c) => (
                    <td key={c} className={styles.num}>
                      <Bone w={cw} h={12} style={{ marginLeft: "auto" }} />
                    </td>
                  ))}
                  <td className={styles.tail} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Loading>
  );
}

function WatchlistsPage() {
  const phone = useMediaQuery("(max-width: 600px)");
  const loading = useLoadingView();
  const lists = useWatchlists();
  if (loading) return <WatchlistsLoading phone={phone} />;
  return phone ? <Phone w={lists} /> : <Desktop w={lists} />;
}

type Lists = ReturnType<typeof useWatchlists>;

/** What both layouts share: the lists, the one you're looking at, and what
    you can do to it. */
function useWatchlists() {
  const { state, services } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mine = ownLists(state);
  const shared = sharedLists(state);
  const current =
    [...mine, ...shared].find((l) => l.id === params.get("list")) ?? mine[0];
  const markets = current.marketIds
    .map((id) => services.markets.get(id))
    .filter((m): m is Market => !!m);
  const rooms = state.rooms.filter((r) => r.members.includes("you"));
  const tell = (next: Notice | null) => {
    clearTimeout(timer.current);
    setNotice(next);
    if (next) timer.current = setTimeout(() => setNotice(null), 6000);
  };
  const go = (id: string) => router.replace(hrefOf(id), { scroll: false });
  return {
    mine,
    shared,
    current,
    markets,
    rooms,
    notice,
    dismiss: () => tell(null),
    go,
    meta: (l: ListView) =>
      l.kind === "room"
        ? `Room watchlist · ${marketCount(l.marketIds.length)}`
        : `${marketCount(l.marketIds.length)} · ${
            l.kind === "saved" ? "Default" : updatedLabel(l.updatedAt!, now)
          }`,
    /** Take a market off the list, with a way to put it back. */
    remove(m: Market) {
      if (current.kind === "room") return;
      const list = current;
      const index = list.marketIds.indexOf(m.id);
      services.watchlists.toggleMarket(list.id, m.id);
      tell({
        text: `Removed ${m.shortTitle} from ${list.name}`,
        undo: () => {
          try {
            services.watchlists.place(list.id, m.id, index);
          } catch (e) {
            tell({ text: (e as Error).message });
          }
        },
      });
    },
    /** Add the list's markets to a room's shared watchlist. */
    async share(room: Room) {
      try {
        const added = await services.social.addRoomMarkets(
          room.id,
          current.marketIds,
        );
        tell({
          text: added
            ? `Shared ${marketCount(added)} to ${room.name}`
            : `${room.name} already watches all of these`,
          link: { label: "Open room", href: `/rooms/${room.id}` },
        });
      } catch (e) {
        tell({ text: (e as Error).message });
      }
    },
    async create(name: string) {
      try {
        const id = await services.watchlists.create(name);
        go(id);
        return id;
      } catch (e) {
        tell({ text: (e as Error).message });
        return null;
      }
    },
    rename: (name: string) => services.watchlists.rename(current.id, name),
    deleteList() {
      const name = current.name;
      services.watchlists.remove(current.id);
      go(SAVED_LIST);
      tell({ text: `Deleted ${name}` });
    },
  };
}

/* --------------------------------------------------------- 10.1 desktop */
function Desktop({ w }: { w: Lists }) {
  const { current, markets } = w;
  // Kept per list, so switching lists leaves each where it was.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const editing = editingId === current.id && current.kind !== "room";
  return (
    <div className={styles.page}>
      <div className={styles.rail}>
        <header className={styles.railHead}>
          <h1>Watchlists</h1>
          <button
            type="button"
            className={`btn btn-secondary ${styles.new}`}
            onClick={async () => {
              const id = await w.create("Untitled list");
              if (id) setNaming({ id, draft: "Untitled list" });
            }}
          >
            <Plus size={14} />
            New
          </button>
        </header>
        <nav aria-label="Your watchlists">
          <ul className={styles.lists}>
            {w.mine.map((l) => (
              <li key={l.id}>
                <ListLink list={l} current={current} meta={w.meta(l)} />
              </li>
            ))}
          </ul>
          {w.shared.length > 0 && (
            <>
              <h2 className={styles.railLabel}>Shared with you</h2>
              <ul className={`${styles.lists} ${styles.sharedLists}`}>
                {w.shared.map((l) => (
                  <li key={l.id}>
                    <ListLink list={l} current={current} meta={w.meta(l)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
      </div>
      <section className={styles.detail} aria-label={current.name}>
        <header className={styles.detailHead}>
          {naming?.id === current.id ? (
            <RenameForm
              key={current.id}
              draft={naming.draft}
              onSave={(name) => {
                w.rename(name);
                setNaming(null);
              }}
              onCancel={() => setNaming(null)}
            />
          ) : confirmId === current.id ? (
            <div className={styles.confirm}>
              <p>
                <b>Delete “{current.name}”?</b>
                <span>The markets in it stay in your other lists.</span>
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmId(null)}
              >
                Keep list
              </button>
              <button
                type="button"
                className="btn btn-destructive"
                onClick={() => {
                  setConfirmId(null);
                  setEditingId(null);
                  w.deleteList();
                }}
              >
                Delete list
              </button>
            </div>
          ) : (
            <>
              <h2>{current.name}</h2>
              <span className="tag tag-neutral">{TAG[current.kind]}</span>
              <span className={styles.flex} />
              <div className={styles.actions}>
                {current.kind === "room" ? (
                  <Link
                    href={`/rooms/${current.room!.id}`}
                    className="btn btn-secondary"
                  >
                    Open room
                    <ArrowUpRight size={14} />
                  </Link>
                ) : editing ? (
                  <>
                    {current.kind === "own" && (
                      <button
                        type="button"
                        className={`btn btn-ghost ${styles.deleteList}`}
                        onClick={() => setConfirmId(current.id)}
                      >
                        <Trash2 size={14} />
                        Delete list
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-pressed="true"
                      onClick={() => setEditingId(null)}
                    >
                      <ListChecks size={14} />
                      Done
                    </button>
                  </>
                ) : (
                  <>
                    {current.kind === "own" && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          setNaming({ id: current.id, draft: current.name })
                        }
                      >
                        <Pencil size={14} />
                        Rename
                      </button>
                    )}
                    <ShareMenu w={w} />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-pressed="false"
                      disabled={current.kind === "saved" && !markets.length}
                      onClick={() => setEditingId(current.id)}
                    >
                      <ListChecks size={14} />
                      Edit list
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </header>
        <div className={styles.body}>
          {markets.length ? (
            <MarketTable
              key={current.id}
              list={current}
              markets={markets}
              editing={editing}
              onRemove={w.remove}
            />
          ) : (
            <EmptyList list={current} />
          )}
        </div>
        <Toast notice={w.notice} onDismiss={w.dismiss} />
      </section>
    </div>
  );
}

function ListLink({
  list,
  current,
  meta,
}: {
  list: ListView;
  current: ListView;
  meta: string;
}) {
  return (
    <Link
      href={hrefOf(list.id)}
      scroll={false}
      className={styles.listLink}
      aria-current={list.id === current.id ? "page" : undefined}
    >
      <b>{list.name}</b>
      <span>{meta}</span>
    </Link>
  );
}

/** Name a list in place: Enter saves, Escape leaves it as it was. */
function RenameForm({
  draft: initial,
  onSave,
  onCancel,
}: {
  draft: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => input.current?.select(), []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      onSave(draft);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form className={styles.rename} onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        List name
      </label>
      <input
        ref={input}
        id={id}
        className={`input ${styles.nameInput}`}
        value={draft}
        maxLength={60}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="submit" className="btn btn-primary">
        Save
      </button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Share to room: pick one of your rooms; its watchlist gains what it
    lacks. */
function ShareMenu({ w }: { w: Lists }) {
  if (!w.markets.length)
    return (
      <button type="button" className="btn btn-secondary" disabled>
        <ShareNetwork size={14} />
        Share to room
      </button>
    );
  return (
    <Menu
      label="Share to room"
      triggerClassName="btn btn-secondary"
      trigger={
        <>
          <ShareNetwork size={14} />
          Share to room
        </>
      }
    >
      {w.rooms.length ? (
        w.rooms.map((r) => (
          <MenuItem key={r.id} onSelect={() => w.share(r)}>
            {r.name}
          </MenuItem>
        ))
      ) : (
        <MenuItem href="/rooms">Find a room to join</MenuItem>
      )}
    </Menu>
  );
}

/**
 * Reordering, by drag or by keyboard: on a handle, the arrow keys move the
 * market one place and keep focus with it; a drag shows where it will
 * land. Both are announced.
 */
function useReorder(list: ListView, markets: Market[]) {
  const { services } = useDemo();
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
  } | null>(null);
  const [said, setSaid] = useState("");
  const move = (m: Market, to: number) => {
    const from = markets.findIndex((x) => x.id === m.id);
    const at = Math.max(0, Math.min(markets.length - 1, to));
    if (at === from) return;
    services.watchlists.place(list.id, m.id, at);
    setSaid(`${m.shortTitle} moved to ${at + 1} of ${markets.length}.`);
    // The row moved in the DOM; keep focus on its handle.
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-handle="${CSS.escape(m.id)}"]`)
        ?.focus(),
    );
  };
  // Where the dragged market would land, as the row it goes above.
  const drop =
    drag && drag.to !== drag.from
      ? drag.to < drag.from
        ? drag.to
        : drag.to + 1
      : null;
  return {
    said,
    row: (m: Market, i: number) => ({
      "data-dragging": drag?.id === m.id || undefined,
      "data-drop":
        drop === i
          ? "before"
          : drop === markets.length && i === markets.length - 1
            ? "after"
            : undefined,
    }),
    handle: (m: Market, i: number) => ({
      "data-handle": m.id,
      "aria-label": `Reorder ${m.shortTitle}`,
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        move(m, i + (e.key === "ArrowUp" ? -1 : 1));
      },
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const el = e.currentTarget;
        const rows = Array.from(el.closest("[data-rows]")?.children ?? []);
        const middles = rows.map((r) => {
          const box = r.getBoundingClientRect();
          return box.top + box.height / 2;
        });
        // The place among the other rows that the pointer is at.
        const place = (y: number) =>
          middles.filter((mid, j) => j !== i && mid < y).length;
        el.setPointerCapture(e.pointerId);
        setDrag({ id: m.id, from: i, to: i });
        const onMove = (ev: PointerEvent) =>
          setDrag({ id: m.id, from: i, to: place(ev.clientY) });
        const stop = () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", stop);
          window.removeEventListener("keydown", onKey);
          setDrag(null);
        };
        const onUp = (ev: PointerEvent) => {
          stop();
          move(m, place(ev.clientY));
        };
        const onKey = (ev: globalThis.KeyboardEvent) => {
          if (ev.key === "Escape") stop();
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", stop);
        window.addEventListener("keydown", onKey);
      },
    }),
  };
}

function MarketTable({
  list,
  markets,
  editing,
  onRemove,
}: {
  list: ListView;
  markets: Market[];
  editing: boolean;
  onRemove: (m: Market) => void;
}) {
  const hint = useId();
  const reorder = useReorder(list, markets);
  const own = list.kind !== "room";
  return (
    <>
      <table className={styles.table} data-editing={editing || undefined}>
        <caption className="sr-only">Markets in {list.name}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.colLead}>
              <span className="sr-only">{editing ? "Order" : "Saved"}</span>
            </th>
            <th scope="col">Market</th>
            <th scope="col" className={styles.colSpark}>
              7d
            </th>
            <th scope="col" className={`${styles.num} ${styles.colYes}`}>
              Yes
            </th>
            <th scope="col" className={`${styles.num} ${styles.colNo}`}>
              No
            </th>
            <th scope="col" className={`${styles.num} ${styles.colChange}`}>
              24h
            </th>
            <th scope="col" className={`${styles.num} ${styles.colCloses}`}>
              Closes
            </th>
            <th scope="col" className={styles.colTail}>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody data-rows>
          {markets.map((m, i) => (
            <tr key={m.id} {...reorder.row(m, i)}>
              <td className={styles.lead}>
                {editing ? (
                  <button
                    type="button"
                    className={styles.handle}
                    aria-describedby={hint}
                    {...reorder.handle(m, i)}
                  >
                    <DotsSixVertical size={16} />
                  </button>
                ) : (
                  <BookmarkSimple size={15} />
                )}
              </td>
              <th scope="row">
                <Link href={`/market/${m.id}`} className={styles.market}>
                  <b>{m.title}</b>
                  <span>
                    {m.category} · {venueName(m.venueId)} · {statusOf(m)}
                  </span>
                </Link>
              </th>
              <td className={`${styles.sparkCell} ${styles.colSpark}`}>
                <Spark
                  data={m.series}
                  change={m.change}
                  className={styles.spark}
                />
              </td>
              <td className={`${styles.num} ${styles.yes}`}>
                <Flash value={priceFor(m, "Yes")}>{priceFor(m, "Yes")}¢</Flash>
              </td>
              <td className={`${styles.num} ${styles.no} ${styles.colNo}`}>
                {priceFor(m, "No")}¢
              </td>
              <td
                className={`${styles.num} ${styles.change} ${changeTone(m.change)}`}
              >
                {m.status === "open" ? changeText(m.change) : "—"}
              </td>
              <td
                className={`${styles.num} ${styles.closes} ${styles.colCloses}`}
              >
                {closes(m)}
              </td>
              <td className={styles.tail}>
                {own && (
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${m.shortTitle} from ${list.name}`}
                    onClick={() => onRemove(m)}
                  >
                    {editing ? <Trash2 size={15} /> : <X size={15} />}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p id={hint} className="sr-only">
        Press the up or down arrow key to move this market, or drag it.
      </p>
      <p className="sr-only" role="status">
        {reorder.said}
      </p>
    </>
  );
}

function EmptyList({ list }: { list: ListView }) {
  return (
    <div className={styles.empty}>
      <BookmarkSimple size={26} />
      <b>This list is empty</b>
      <p>
        {list.kind === "room"
          ? `Add markets to ${list.name} from the room.`
          : "Save markets from Discover, a post or a room with the bookmark icon."}
      </p>
      <Link
        href={list.kind === "room" ? `/rooms/${list.room!.id}` : "/discover"}
        className="btn btn-primary"
      >
        {list.kind === "room" ? "Open room" : "Find markets"}
      </Link>
    </div>
  );
}

/** One line at the bottom: what just happened, and how to take it back. */
function Toast({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.toastRegion} role="status">
      {notice && (
        <div className={styles.toast}>
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = notice.undo!;
                onDismiss();
                undo();
              }}
            >
              Undo
            </button>
          )}
          {notice.link && (
            <Link href={notice.link.href}>{notice.link.label}</Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- 10.2 phone */
function Phone({ w }: { w: Lists }) {
  const { current, markets } = w;
  const [sheet, setSheet] = useState<"new" | "rename" | "delete" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const editing = editingId === current.id && current.kind !== "room";
  const reorder = useReorder(current, markets);
  const hint = useId();
  const swipeable = current.kind !== "room" && !editing;
  return (
    <div className={styles.phone}>
      <header className={styles.phoneHead}>
        <h1>Watchlists</h1>
        <button
          type="button"
          className={`btn btn-icon ${styles.phoneNew}`}
          aria-label="New list"
          onClick={() => setSheet("new")}
        >
          <Plus size={20} />
        </button>
      </header>
      <nav className={styles.chips} aria-label="Your watchlists" data-indicator="pill">
        {[...w.mine, ...w.shared].map((l) => (
          <Link
            key={l.id}
            href={hrefOf(l.id)}
            scroll={false}
            className={styles.chip}
            aria-current={l.id === current.id ? "page" : undefined}
          >
            {l.kind === "room" && <UsersThree size={14} />}
            {l.name}
          </Link>
        ))}
      </nav>
      <div className={styles.phoneMeta}>
        <span>{w.meta(current)}</span>
        {current.kind === "room" ? (
          <Link
            href={`/rooms/${current.room!.id}`}
            className="btn btn-secondary btn-sm"
          >
            Open room
          </Link>
        ) : editing ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setEditingId(null)}
          >
            Done
          </button>
        ) : (
          <Menu
            label={`${current.name} options`}
            triggerClassName={`btn btn-ghost btn-icon ${styles.more}`}
            trigger={<DotsThree size={20} />}
          >
            {current.kind === "own" && (
              <MenuItem
                icon={<Pencil size={15} />}
                onSelect={() => setSheet("rename")}
              >
                Rename
              </MenuItem>
            )}
            {markets.length > 0 &&
              w.rooms.map((r) => (
                <MenuItem
                  key={r.id}
                  icon={<ShareNetwork size={15} />}
                  onSelect={() => w.share(r)}
                >
                  Share to {r.name}
                </MenuItem>
              ))}
            {markets.length > 0 && (
              <MenuItem
                icon={<ListChecks size={15} />}
                onSelect={() => setEditingId(current.id)}
              >
                Edit list
              </MenuItem>
            )}
            {current.kind === "own" && (
              <MenuItem
                icon={<Trash2 size={15} />}
                tone="negative"
                onSelect={() => setSheet("delete")}
              >
                Delete list
              </MenuItem>
            )}
          </Menu>
        )}
      </div>
      <div className={styles.phoneBody}>
        {markets.length ? (
          <>
            <ul
              className={styles.rows}
              aria-label={`Markets in ${current.name}`}
              data-rows
            >
              {markets.map((m, i) =>
                editing ? (
                  <li
                    key={m.id}
                    className={styles.editRow}
                    {...reorder.row(m, i)}
                  >
                    <button
                      type="button"
                      className={styles.editRemove}
                      aria-label={`Remove ${m.shortTitle} from ${current.name}`}
                      onClick={() => w.remove(m)}
                    >
                      <Trash2 size={16} />
                    </button>
                    <span className={styles.editTitle}>
                      <b>{m.shortTitle}</b>
                      <span>
                        {venueName(m.venueId)} · {statusOf(m)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.handle}
                      aria-describedby={hint}
                      {...reorder.handle(m, i)}
                    >
                      <DotsSixVertical size={18} />
                    </button>
                  </li>
                ) : (
                  <SwipeRow
                    key={m.id}
                    market={m}
                    swipeable={swipeable}
                    open={open === m.id}
                    anyOpen={open !== null}
                    onOpen={(on) => setOpen(on ? m.id : null)}
                    onRemove={() => {
                      setOpen(null);
                      w.remove(m);
                    }}
                  />
                ),
              )}
            </ul>
            {swipeable && (
              <p className={styles.hint}>
                <ArrowsLeftRight size={14} />
                Swipe a row left to remove
              </p>
            )}
            {editing && (
              <p id={hint} className={styles.hint}>
                Drag a handle, or focus it and use the arrow keys, to reorder.
              </p>
            )}
            <p className="sr-only" role="status">
              {reorder.said}
            </p>
          </>
        ) : (
          <EmptyList list={current} />
        )}
      </div>
      <Toast notice={w.notice} onDismiss={w.dismiss} />
      <Modal
        open={sheet === "new" || sheet === "rename"}
        onOpenChange={(on) => !on && setSheet(null)}
        title={sheet === "rename" ? "Rename list" : "New watchlist"}
        description={
          sheet === "rename"
            ? `A new name for ${current.name}.`
            : "Name it for what you’re watching."
        }
      >
        <NameSheet
          key={`${sheet}-${current.id}`}
          initial={sheet === "rename" ? current.name : ""}
          action={sheet === "rename" ? "Save" : "Create list"}
          onSave={(name) => {
            if (sheet === "rename") w.rename(name);
            else w.create(name);
            setSheet(null);
          }}
        />
      </Modal>
      <Modal
        open={sheet === "delete"}
        onOpenChange={(on) => !on && setSheet(null)}
        title={`Delete “${current.name}”?`}
        description="The markets in it stay in your other lists."
      >
        <div className={styles.sheetActions}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSheet(null)}
          >
            Keep list
          </button>
          <button
            type="button"
            className="btn btn-destructive"
            onClick={() => {
              setSheet(null);
              w.deleteList();
            }}
          >
            Delete list
          </button>
        </div>
      </Modal>
    </div>
  );
}

function NameSheet({
  initial,
  action,
  onSave,
}: {
  initial: string;
  action: string;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const id = useId();
  return (
    <form
      className={styles.nameSheet}
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(draft);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label htmlFor={id}>List name</label>
      <input
        id={id}
        className="input"
        value={draft}
        maxLength={60}
        autoComplete="off"
        placeholder="Rates & inflation"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
      />
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg">
        {action}
      </button>
    </form>
  );
}

/**
 * 10.2 · a row that swipes: a short swipe shows Remove, a long one removes
 * it outright. A tap elsewhere puts an open row back.
 */
function SwipeRow({
  market,
  swipeable,
  open,
  anyOpen,
  onOpen,
  onRemove,
}: {
  market: Market;
  swipeable: boolean;
  open: boolean;
  anyOpen: boolean;
  onOpen: (open: boolean) => void;
  onRemove: () => void;
}) {
  const ACTION = 96;
  const row = useRef<HTMLLIElement>(null);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const offset = dx ?? (open ? -ACTION : 0);
  const end = () => {
    const width = row.current?.offsetWidth ?? 400;
    const at = dx ?? 0;
    setDx(null);
    start.current = null;
    if (at < -width * 0.5) {
      setLeaving(true);
      setTimeout(onRemove, 180);
    } else onOpen(at < -ACTION / 2);
  };
  return (
    <li ref={row} className={styles.swipe}>
      <button
        type="button"
        className={styles.swipeAction}
        tabIndex={open ? 0 : -1}
        aria-hidden={open ? undefined : true}
        onClick={onRemove}
      >
        <Trash2 size={16} />
        Remove
      </button>
      <Link
        href={`/market/${market.id}`}
        className={styles.phoneRow}
        draggable={false}
        data-moving={dx !== null || undefined}
        style={{
          transform: leaving
            ? "translateX(-100%)"
            : offset
              ? `translateX(${offset}px)`
              : undefined,
        }}
        onPointerDown={(e) => {
          if (!swipeable || (e.pointerType === "mouse" && e.button !== 0))
            return;
          start.current = {
            x: e.clientX,
            y: e.clientY,
            base: open ? -ACTION : 0,
          };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const x = e.clientX - s.x;
          const y = e.clientY - s.y;
          if (dx === null) {
            // A scroll, not a swipe: let it go.
            if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) {
              start.current = null;
              return;
            }
            if (Math.abs(x) < 8) return;
            moved.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(Math.min(0, s.base + x));
        }}
        onPointerUp={() => {
          if (dx !== null) end();
          else start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(null);
        }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            moved.current = false;
          } else if (anyOpen) {
            e.preventDefault();
            onOpen(false);
          }
        }}
      >
        <b className={styles.phoneTitle}>{market.shortTitle}</b>
        <b className={styles.phonePrice}>
          <Flash value={priceFor(market, "Yes")}>{priceFor(market, "Yes")}¢</Flash>
        </b>
        <span className={styles.phoneStatus}>
          {venueName(market.venueId)} · {statusOf(market)}
        </span>
        <span className={`${styles.phoneMove} ${changeTone(market.change)}`}>
          {market.status === "open" ? changeText(market.change) : "Settled"}
        </span>
      </Link>
    </li>
  );
}
