"use client";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BookmarkSimple,
  MagnifyingGlass,
  Plus,
  Users,
  X,
} from "@/components/icons";
import { useDemo, useLoadingView } from "@/services/provider";
import { Bone, BoneLines, Loading } from "@/components/skeleton";
import type { Category, Room } from "@imo/domain/types";
import { Empty } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import { JoinButton, MarketPicker, RoomMark } from "./room-parts";
import styles from "./rooms.module.css";

/** 08.1 filters by interest, not by privacy; a room matches a category when
    any market on its shared watchlist belongs to it. */
const FILTERS = [
  "All",
  "Joined",
  "Economics",
  "Politics",
  "Sports",
  "Tech & AI",
] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_CATEGORIES: Partial<Record<Filter, Category[]>> = {
  Economics: ["Economics"],
  Politics: ["Politics"],
  Sports: ["Sports"],
  "Tech & AI": ["Tech"],
};
const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"} today`;

/** 08.1 / 08.2 · the rooms directory. */
const LOADING_ROOMS = [104, 86, 118, 92, 110, 80];

function CardsLoading() {
  return (
    <Loading label="Loading rooms" className={styles.grid}>
      {LOADING_ROOMS.map((w, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.cardHead}>
            <Bone w={36} h={36} r={10} />
            <span className={styles.cardTitle} style={{ gap: 7 }}>
              <Bone w={w} h={13} />
              <Bone w={w + 30} h={9} />
            </span>
            <Bone w={60} h={28} r="pill" />
          </div>
          <BoneLines lines={2} h={10} last={i % 2 ? "45%" : "70%"} />
          <div className={styles.cardFoot}>
            <Bone w={46} h={10} />
            <Bone w={58} h={10} />
            <Bone w={66} h={10} />
            <span className={styles.flex} />
            <Bone w={72} h={10} />
          </div>
        </div>
      ))}
    </Loading>
  );
}

function RowsLoading() {
  return (
    <Loading label="Loading rooms">
      {LOADING_ROOMS.map((w, i) => (
        <div key={i} className={styles.row}>
          <Bone w={36} h={36} r={10} />
          <span className={styles.rowLink} style={{ gap: 7 }}>
            <Bone w={w} h={13} />
            <Bone w={w + 40} h={9} />
          </span>
          <Bone w={56} h={28} r="pill" />
        </div>
      ))}
    </Loading>
  );
}

export function Rooms() {
  const { services, state } = useDemo();
  const loading = useLoadingView();
  const phone = useMediaQuery("(max-width: 600px)");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [create, setCreate] = useState(false);
  const searchId = useId();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (r: Room) =>
    words.every((w) => `${r.name} ${r.description}`.toLowerCase().includes(w));
  const inFilter = (r: Room) => {
    if (filter === "All") return true;
    if (filter === "Joined") return r.members.includes("you");
    const wanted = FILTER_CATEGORIES[filter] ?? [];
    return r.watchlist.some((mid) => {
      const category = services.markets.get(mid)?.category;
      return !!category && wanted.includes(category);
    });
  };
  const joined = state.rooms.filter((r) => r.members.includes("you"));
  const list = state.rooms.filter((r) => matches(r) && (phone || inFilter(r)));
  const owner = (r: Room) =>
    r.owner === "you" ? "you" : services.profiles.get(r.owner)?.name;

  const search = (
    <label className={styles.search} htmlFor={searchId}>
      <MagnifyingGlass size={15} />
      <span className="sr-only">Search rooms</span>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search rooms"
      />
    </label>
  );
  const filtered = !!words.length || filter !== "All";
  const empty =
    !filtered && !state.rooms.length ? (
      <Empty
        title="No rooms yet"
        description="Rooms are trading communities with a shared watchlist. Start the first one."
        action={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreate(true)}
          >
            Create room
          </button>
        }
      />
    ) : (
      <Empty
        title="No rooms match that"
        description="Try another filter, or start the room you were looking for."
        action={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setFilter("All");
                setQuery("");
              }}
            >
              Clear filters
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreate(true)}
            >
              Create room
            </button>
          </>
        }
      />
    );

  if (phone) {
    const mine = list.filter((r) => r.members.includes("you"));
    const others = list.filter((r) => !r.members.includes("you"));
    const row = (r: Room) => (
      <div key={r.id} className={styles.row}>
        <RoomMark room={r} />
        <Link href={`/rooms/${r.id}`} className={styles.rowLink}>
          <b>{r.name}</b>
          <span>
            {r.memberCount.toLocaleString("en-US")} members ·{" "}
            {posts(r.postsToday)}
          </span>
        </Link>
        <JoinButton room={r} chip />
      </div>
    );
    return (
      <div className={styles.phone}>
        <header className={styles.phoneHead}>
          <h1>Rooms</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreate(true)}
          >
            <Plus size={15} />
            Create
          </button>
        </header>
        {search}
        {loading && <RowsLoading />}
        {!loading && !!mine.length && (
          <section aria-labelledby="your-rooms">
            <h2 id="your-rooms" className={styles.label}>
              Your rooms
            </h2>
            {mine.map(row)}
          </section>
        )}
        {!loading && !!others.length && (
          <section aria-labelledby="more-rooms">
            <h2 id="more-rooms" className={styles.label}>
              {mine.length ? "More rooms" : "Rooms"}
            </h2>
            {others.map(row)}
          </section>
        )}
        {!loading && !list.length && empty}
        <CreateRoom open={create} onOpenChange={setCreate} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h1>Rooms</h1>
          {loading ? (
            <Bone w={330} h={12} style={{ margin: "9px 0 3px" }} />
          ) : (
            <p>
              Trading communities with a shared watchlist. You’re in{" "}
              {joined.length}.
            </p>
          )}
        </div>
        {search}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreate(true)}
        >
          Create room
        </button>
      </header>
      <div className={styles.filters} role="group" aria-label="Filter rooms" data-indicator="pill">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <CardsLoading />
      ) : list.length ? (
        <div className={styles.grid}>
          {list.map((r) => (
            <article key={r.id} className={styles.card}>
              <div className={styles.cardHead}>
                <RoomMark room={r} />
                <Link href={`/rooms/${r.id}`} className={styles.cardTitle}>
                  <b>{r.name}</b>
                  <span>
                    by {owner(r)} · {r.privacy}
                  </span>
                </Link>
                <JoinButton room={r} />
              </div>
              <p className={styles.topic}>{r.description}</p>
              <div className={styles.cardFoot}>
                <span>
                  <Users size={13} />
                  {r.memberCount.toLocaleString("en-US")}
                </span>
                <span>
                  <i className={styles.dot} aria-hidden="true" />
                  {r.online} online
                </span>
                <span>
                  <BookmarkSimple size={13} />
                  {r.watchlist.length}{" "}
                  {r.watchlist.length === 1 ? "market" : "markets"}
                </span>
                <span className={styles.flex} />
                <span>{posts(r.postsToday)}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        empty
      )}
      <CreateRoom open={create} onOpenChange={setCreate} />
    </div>
  );
}

/** 08.3 · name, purpose, who can join, a seeded watchlist, disclosure. */
function CreateRoom({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { services } = useDemo();
  const router = useRouter();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [privacy, setPrivacy] = useState<Room["privacy"]>("Public");
  const [seed, setSeed] = useState<string[]>([]);
  const [disclosure, setDisclosure] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const id = useId();
  const reset = () => {
    setName("");
    setTopic("");
    setPrivacy("Public");
    setSeed([]);
    setDisclosure(true);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const rid = await services.social.createRoom({
        name,
        description: topic,
        privacy,
        watchlist: seed,
        disclosure,
      });
      onOpenChange(false);
      reset();
      router.push(`/rooms/${rid}`);
    } catch (e) {
      // The server's reason, e.g. the cap on rooms you own.
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) reset();
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal modal-sheet ${styles.dialog}`}
          aria-describedby={`${id}-note`}
        >
          <header className={styles.dialogHead}>
            <Dialog.Title>Create a room</Dialog.Title>
            <Dialog.Close className="btn btn-icon" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </header>
          <form className={styles.dialogBody} onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor={`${id}-name`}>Name</label>
              <input
                id={`${id}-name`}
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jobs Report Club"
                maxLength={60}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-topic`}>What’s it for?</label>
              <textarea
                id={`${id}-topic`}
                className={`input ${styles.textarea}`}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                placeholder="NFP, JOLTS and claims. One thread per release."
              />
            </div>
            <fieldset className={`field ${styles.fieldset}`}>
              <legend>Who can join</legend>
              <div className={styles.radios}>
                {(
                  [
                    ["Public", "Public — anyone can join and read"],
                    [
                      "Invite only",
                      "Invite only — members approve new joiners",
                    ],
                  ] as const
                ).map(([value, text]) => (
                  <label key={value} className="radio">
                    <input
                      type="radio"
                      name={`${id}-privacy`}
                      checked={privacy === value}
                      onChange={() => setPrivacy(value)}
                    />
                    <span className="dot" />
                    {text}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <span className={styles.fieldLabel} id={`${id}-seed`}>
                Seed the shared watchlist
              </span>
              <div
                className={styles.seed}
                role="group"
                aria-labelledby={`${id}-seed`}
              >
                {seed.map((mid) => {
                  const m = services.markets.get(mid)!;
                  return (
                    <span key={mid} className="tag tag-neutral">
                      {m.shortTitle}
                      <button
                        type="button"
                        aria-label={`Remove ${m.shortTitle}`}
                        onClick={() => setSeed(seed.filter((x) => x !== mid))}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
                <MarketPicker
                  label="Add market"
                  triggerClassName={`tag tag-outline ${styles.addMarket}`}
                  trigger={
                    <>
                      <Plus size={11} />
                      Add market
                    </>
                  }
                  selected={seed}
                  keepOpen
                  onPick={(m) =>
                    setSeed(
                      seed.includes(m.id)
                        ? seed.filter((x) => x !== m.id)
                        : [...seed, m.id],
                    )
                  }
                />
              </div>
            </div>
            <label className={styles.disclosure}>
              <input
                type="checkbox"
                checked={disclosure}
                onChange={(e) => setDisclosure(e.target.checked)}
              />
              <span>
                <b>Require position disclosure</b>
                <span>
                  Members’ holdings show on messages about linked markets.
                </span>
              </span>
            </label>
            <p id={`${id}-note`} className={styles.note}>
              You can change the name, privacy and rules later from Manage room.
            </p>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className={styles.dialogFoot}>
              <Dialog.Close className="btn btn-secondary" type="button">
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!name.trim() || creating}
              >
                {creating ? "Creating…" : "Create room"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
