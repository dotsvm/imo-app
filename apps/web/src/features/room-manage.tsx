"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Room, RoomRole, Trader } from "@imo/domain/types";
import { useDemo } from "@/services/provider";
import { canModerate, roleOf } from "@imo/domain/rooms";
import { CaretDown, Plus, UserMinus, X } from "@/components/icons";
import { Avatar, meta as factLine } from "@/components/ui";
import { Menu, MenuItem } from "@/components/menu";
import { MarketPicker } from "./room-parts";
import styles from "./room-manage.module.css";
import { venueName } from "@/data/venues";

export const MANAGE_TABS = [
  "Members",
  "Requests",
  "Rules",
  "Watchlist",
] as const;
export type ManageTab = (typeof MANAGE_TABS)[number];

/**
 * 09.3 · run the room. The owner changes roles, hands the room over or
 * archives it; moderators approve requests, remove members and set the
 * rules; every member can shape the shared watchlist.
 */
export function ManageRoom({
  room,
  tab,
  onTab,
  onClose,
}: {
  room: Room;
  tab: ManageTab | null;
  onTab: (tab: ManageTab) => void;
  onClose: () => void;
}) {
  const { services } = useDemo();
  const router = useRouter();
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const owner = services.profiles.get(room.owner);
  const isOwner = room.owner === "you";
  const moderator = canModerate(room);
  const member = room.members.includes("you");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<
    { kind: "archive" } | { kind: "transfer"; to: Trader } | null
  >(null);
  const act = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const people = room.members
    .map((m) => services.profiles.get(m))
    .filter((t): t is Trader => !!t)
    .toSorted((a, b) => rank(room, a.id) - rank(room, b.id));
  const onKey = (event: KeyboardEvent) => {
    if (!tab) return;
    const at = MANAGE_TABS.indexOf(tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % MANAGE_TABS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + MANAGE_TABS.length) % MANAGE_TABS.length
          : -1;
    if (to < 0) return;
    event.preventDefault();
    onTab(MANAGE_TABS[to]);
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [to]?.focus();
  };
  const meta = (t: Trader) => {
    const role = roleOf(room, t.id);
    return t.id === room.owner || t.id === "you"
      ? `${role} · joined ${t.joined}`
      : `${role} · ${t.stats.All.resolved.toLocaleString("en-US")} resolved`;
  };

  return (
    <Dialog.Root
      open={!!tab}
      onOpenChange={(open) => {
        if (!open) {
          setConfirm(null);
          setError("");
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal modal-sheet ${styles.dialog}`}
          aria-describedby={undefined}
        >
          <header className={styles.head}>
            <Dialog.Title>Manage {room.name}</Dialog.Title>
            <span className="tag tag-neutral">
              Owner · {isOwner ? "you" : owner?.name}
            </span>
            <Dialog.Close className="btn btn-icon" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div
            ref={tabs}
            className={styles.tabs}
            role="tablist"
            aria-label="Room settings"
            onKeyDown={onKey}
          >
            {MANAGE_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`${id}-${t}`}
                aria-selected={tab === t}
                aria-controls={`${id}-panel`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => onTab(t)}
              >
                {t}
                {t === "Requests" && room.requests.length > 0 && (
                  <> · {room.requests.length}</>
                )}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={tab ? `${id}-${tab}` : undefined}
            className={styles.panel}
          >
            {tab === "Members" &&
              people.map((t) => {
                const role = roleOf(room, t.id);
                const removable =
                  moderator &&
                  t.id !== room.owner &&
                  t.id !== "you" &&
                  (isOwner || role === "Member");
                return (
                  <div key={t.id} className={styles.person}>
                    <Avatar trader={t} size={32} />
                    <span className={styles.personText}>
                      <b>{t.id === "you" ? `${t.name} (you)` : t.name}</b>
                      <span>{meta(t)}</span>
                    </span>
                    {isOwner && t.id !== "you" ? (
                      <Menu
                        label={`${t.name}’s role: ${role}`}
                        triggerClassName={`btn btn-secondary ${styles.role}`}
                        trigger={
                          <>
                            {role}
                            <CaretDown size={12} />
                          </>
                        }
                      >
                        {(["Member", "Moderator", "Owner"] as RoomRole[]).map(
                          (r) => (
                            <MenuItem
                              key={r}
                              checked={role === r}
                              onSelect={() =>
                                r === "Owner"
                                  ? setConfirm({ kind: "transfer", to: t })
                                  : act(() =>
                                      services.social.setRole(room.id, t.id, r),
                                    )
                              }
                            >
                              {r}
                            </MenuItem>
                          ),
                        )}
                      </Menu>
                    ) : (
                      <span className="tag tag-neutral">{role}</span>
                    )}
                    {removable ? (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label={`Remove ${t.name}`}
                        data-tip="Remove"
                        onClick={() =>
                          act(() => services.social.removeMember(room.id, t.id))
                        }
                      >
                        <UserMinus size={16} />
                      </button>
                    ) : (
                      <span className={styles.spacer} aria-hidden="true" />
                    )}
                  </div>
                );
              })}

            {tab === "Requests" &&
              (!moderator ? (
                <p className={styles.note}>
                  Only the owner and moderators see who has asked to join.
                </p>
              ) : room.requests.length ? (
                room.requests.map((rid) => {
                  const t = services.profiles.get(rid);
                  if (!t) return null;
                  return (
                    <div key={rid} className={styles.person}>
                      <Avatar trader={t} size={32} />
                      <span className={styles.personText}>
                        <b>{t.name}</b>
                        <span>
                          {factLine(t.focus, `${t.stats.All.resolved} resolved`)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          act(() =>
                            services.social.answerRequest(room.id, rid, true),
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          act(() =>
                            services.social.answerRequest(room.id, rid, false),
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className={styles.note}>
                  {room.privacy === "Public"
                    ? `${room.name} is public — anyone can join, so there’s nothing to approve.`
                    : "No one is waiting to join."}
                </p>
              ))}

            {tab === "Rules" && (
              <RulesTab room={room} editable={moderator} onError={setError} />
            )}

            {tab === "Watchlist" && (
              <div className={styles.watchlist}>
                {room.watchlist.map((mid) => {
                  const m = services.markets.get(mid)!;
                  return (
                    <div key={mid} className={styles.market}>
                      <span>
                        <b>{m.shortTitle}</b>
                        <span>
                          {venueName(m.venueId)} · {m.yesPrice}¢
                        </span>
                      </span>
                      {member && (
                        <button
                          type="button"
                          className="btn btn-icon"
                          aria-label={`Remove ${m.shortTitle} from the room`}
                          onClick={() =>
                            services.social.toggleRoomMarket(room.id, mid)
                          }
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {!room.watchlist.length && (
                  <p className={styles.note}>The room has no markets yet.</p>
                )}
                {member ? (
                  <MarketPicker
                    label="Add a market to the room"
                    triggerClassName="btn btn-secondary"
                    trigger={
                      <>
                        <Plus size={14} />
                        Add market
                      </>
                    }
                    selected={room.watchlist}
                    keepOpen
                    placement="above"
                    onPick={(m) =>
                      services.social.toggleRoomMarket(room.id, m.id)
                    }
                  />
                ) : (
                  <p className={styles.note}>
                    Join the room to shape its watchlist.
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className={`field-error ${styles.error}`} role="alert">
              {error}
            </p>
          )}

          <footer className={styles.danger}>
            {confirm ? (
              <div className={styles.confirm} role="alert">
                <b>
                  {confirm.kind === "archive"
                    ? `Archive ${room.name}?`
                    : `Hand ${room.name} to ${confirm.to.name}?`}
                </b>
                <span>
                  {confirm.kind === "archive"
                    ? "The channels and the shared watchlist go for everyone. This can’t be undone."
                    : "They become the owner. You stay on as a moderator."}
                </span>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`btn ${confirm.kind === "archive" ? "btn-destructive" : "btn-primary"}`}
                    onClick={() => {
                      if (confirm.kind === "archive") {
                        act(() => services.social.archiveRoom(room.id));
                        onClose();
                        router.push("/rooms");
                      } else {
                        act(() =>
                          services.social.setRole(
                            room.id,
                            confirm.to.id,
                            "Owner",
                          ),
                        );
                        setConfirm(null);
                      }
                    }}
                  >
                    {confirm.kind === "archive"
                      ? "Archive room"
                      : `Transfer to ${confirm.to.name.split(" ")[0]}`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <b>Danger zone</b>
                <div className={styles.actions}>
                  {isOwner ? (
                    <>
                      <Menu
                        label="Transfer ownership"
                        align="start"
                        triggerClassName="btn btn-secondary"
                        trigger="Transfer ownership"
                      >
                        {people
                          .filter((t) => t.id !== "you")
                          .map((t) => (
                            <MenuItem
                              key={t.id}
                              onSelect={() =>
                                setConfirm({ kind: "transfer", to: t })
                              }
                            >
                              {t.name}
                            </MenuItem>
                          ))}
                      </Menu>
                      <button
                        type="button"
                        className={`btn btn-secondary ${styles.archive}`}
                        onClick={() => setConfirm({ kind: "archive" })}
                      >
                        Archive room
                      </button>
                    </>
                  ) : member ? (
                    <button
                      type="button"
                      className={`btn btn-secondary ${styles.archive}`}
                      onClick={() => {
                        act(() => services.social.joinRoom(room.id));
                        onClose();
                      }}
                    >
                      Leave room
                    </button>
                  ) : (
                    <span className={styles.note}>
                      Only {owner?.name ?? "the owner"} can transfer or archive
                      this room.
                    </span>
                  )}
                </div>
              </>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const rank = (room: Room, id: string) =>
  id === room.owner
    ? 0
    : room.moderators.includes(id)
      ? 1
      : id === "you"
        ? 3
        : 2;

/** The room's rules and whether holdings show on messages. */
function RulesTab({
  room,
  editable,
  onError,
}: {
  room: Room;
  editable: boolean;
  onError: (message: string) => void;
}) {
  const { services } = useDemo();
  const [rules, setRules] = useState(room.rules);
  const [saved, setSaved] = useState(false);
  const id = useId();
  if (!editable)
    return (
      <div className={styles.rules}>
        <p className={styles.rulesText}>{room.rules || "No rules posted."}</p>
        <p className={styles.note}>
          {room.disclosure
            ? "Members’ holdings show on messages about linked markets."
            : "Holdings stay hidden on messages in this room."}
        </p>
      </div>
    );
  return (
    <form
      className={styles.rules}
      onSubmit={(e) => {
        e.preventDefault();
        try {
          services.social.updateRoom(room.id, { rules });
          setSaved(true);
          onError("");
        } catch (err) {
          onError((err as Error).message);
        }
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-rules`}>Room rules</label>
        <textarea
          id={`${id}-rules`}
          className={`input ${styles.textarea}`}
          value={rules}
          maxLength={600}
          onChange={(e) => {
            setRules(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <label className={styles.disclosure}>
        <input
          type="checkbox"
          checked={room.disclosure}
          onChange={(e) =>
            services.social.updateRoom(room.id, {
              disclosure: e.target.checked,
            })
          }
        />
        <span>
          <b>Require position disclosure</b>
          <span>Members’ holdings show on messages about linked markets.</span>
        </span>
      </label>
      <div className={styles.actions}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={rules.trim() === room.rules}
        >
          Save rules
        </button>
        <span className={styles.note} aria-live="polite">
          {saved ? "Saved" : ""}
        </span>
      </div>
    </form>
  );
}
