/**
 * A room: its markets' live prices, its channels, and the conversation as
 * team-chat rows (avatar, name, what they hold, time, then the words) —
 * not bubbles. Members write; everyone else can join or ask to.
 * New messages arrive by polling every few seconds while the room is open.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { LockIcon } from "phosphor-react-native/src/icons/Lock";
import { PaperPlaneTiltIcon } from "phosphor-react-native/src/icons/PaperPlaneTilt";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { MarketDTO, MarketPage, MessagesDTO, RoomDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { MarketPickerSheet } from "~/features/markets/market-picker-sheet";
import { RoomMenuSheet } from "~/features/rooms/room-menu-sheet";
import { RoomTile } from "~/features/rooms/room-tile";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { price } from "~/lib/format";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space } from "~/theme/tokens";

type Message = MessagesDTO["items"][number];
/** A message on its way: shown at once, marked if it didn't send, retried with the same clientId. */
interface Pending {
  clientId: string;
  channel: string;
  text: string;
  market: MarketDTO | null;
  at: string;
  failed: boolean;
}

const HAIRLINE = "rgba(255, 255, 255, 0.08)";
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const dayOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const scroller = useRef<ScrollView>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [linked, setLinked] = useState<MarketDTO | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [joining, setJoining] = useState(false);
  const [joinProblem, setJoinProblem] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [menu, setMenu] = useState(false);

  const room = useQuery({
    queryKey: ["room", id],
    queryFn: ({ signal }) => api<RoomDTO>(`/rooms/${id}`, { signal }),
  });
  const r = room.data;
  // A private room you're not in comes back locked: who it is, not what's said.
  const inside = r && !r.locked ? r : undefined;
  // Open on the first channel with something unread, else the first.
  const channel =
    picked ??
    inside?.channels.find((c) => c.unread > 0)?.id ??
    inside?.channels[0]?.id ??
    "general";
  const member = !!r?.role;

  const messages = useQuery({
    queryKey: ["room", id, "messages", channel],
    queryFn: ({ signal }) =>
      api<MessagesDTO>(`/rooms/${id}/channels/${channel}/messages`, {
        query: { limit: 60 },
        signal,
      }),
    enabled: !!inside,
    refetchInterval: 5_000,
  });
  const items = messages.data?.items ?? [];
  const strip = useQuery({
    queryKey: ["markets", "byIds", r?.watchlist.join(",")],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { ids: r!.watchlist.join(","), limit: r!.watchlist.length },
        signal,
      }),
    enabled: !!r?.watchlist.length,
  });
  // Markets linked in messages that the strip doesn't already have.
  const linkedIds = [
    ...new Set(items.map((m) => m.marketId).filter((x): x is string => !!x && !r?.watchlist.includes(x))),
  ].sort();
  const linkedMarkets = useQuery({
    queryKey: ["markets", "byIds", linkedIds.join(",")],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { ids: linkedIds.join(","), limit: linkedIds.length },
        signal,
      }),
    enabled: linkedIds.length > 0,
  });
  const marketOf = new Map<string, MarketDTO>(
    [...(strip.data?.items ?? []), ...(linkedMarkets.data?.items ?? []), ...pending.flatMap((p) => (p.market ? [p.market] : []))].map(
      (m) => [m.id, m],
    ),
  );

  // Reading a channel marks it read.
  const lastId = items.at(-1)?.id;
  useEffect(() => {
    if (!member || !lastId) return;
    api(`/rooms/${id}/channels/${channel}/read`, { method: "POST", body: {} })
      .then(() => queryClient.invalidateQueries({ queryKey: ["rooms"] }))
      .catch(() => undefined);
  }, [member, lastId, id, channel, queryClient]);

  async function deliver(p: Pending) {
    setPending((all) => all.map((x) => (x.clientId === p.clientId ? { ...x, failed: false } : x)));
    try {
      await api(`/rooms/${id}/channels/${p.channel}/messages`, {
        body: {
          text: p.text,
          clientId: p.clientId,
          ...(p.market ? { market: p.market.id } : {}),
        },
      });
      // The channel it was sent to, even if you've switched since.
      await queryClient.invalidateQueries({ queryKey: ["room", id, "messages", p.channel] });
      setPending((all) => all.filter((x) => x.clientId !== p.clientId));
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPending((all) => all.map((x) => (x.clientId === p.clientId ? { ...x, failed: true } : x)));
    }
  }

  function send() {
    const text = draft.trim();
    if (!text && !linked) return;
    const p: Pending = {
      clientId: `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      channel,
      text,
      market: linked,
      at: new Date().toISOString(),
      failed: false,
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPending((all) => [...all, p]);
    setDraft("");
    setLinked(null);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    deliver(p);
  }

  async function join() {
    if (!r) return;
    setJoining(true);
    setJoinProblem(null);
    try {
      if (r.privacy === "Public")
        await api(`/rooms/${id}/join`, { method: "PUT" });
      else await api(`/rooms/${id}/requests`, { method: "POST", body: {} });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await Promise.all([
        room.refetch(),
        queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      ]);
    } catch (error) {
      setJoinProblem(error instanceof Error ? error.message : "That didn't go through. Try again.");
    } finally {
      setJoining(false);
    }
  }

  if (room.isError)
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Notice
          title="This room didn't load"
          body={room.error.message}
          action={{ label: "Try again", onPress: () => room.refetch() }}
        />
      </View>
    );

  const here = pending.filter((p) => p.channel === channel);
  const canSend = !!draft.trim() || !!linked;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => [styles.circle40, pressed && styles.circlePressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        {r ? (
          <>
            <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} size={36} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.roomName} numberOfLines={1} accessibilityRole="header">
                {r.name}
              </Text>
              <View style={styles.presence}>
                {r.online > 0 ? <View style={styles.onlineDot} /> : null}
                <Text style={styles.presenceText} numberOfLines={1}>
                  {r.online > 0 ? `${r.online.toLocaleString("en-US")} online · ` : ""}
                  {r.memberCount.toLocaleString("en-US")} {r.memberCount === 1 ? "member" : "members"}
                </Text>
              </View>
            </View>
            {inside ? (
              <Pressable
                onPress={() => setMenu(true)}
                hitSlop={4}
                style={({ pressed }) => [styles.circle36, pressed && styles.circlePressed]}
                accessibilityRole="button"
                accessibilityLabel="Room menu"
              >
                <DotsThreeIcon size={20} weight="bold" color={color.muted} />
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Skeleton width={36} height={36} style={{ borderRadius: 12 }} />
            <View style={{ gap: 6 }}>
              <Skeleton width={140} height={13} />
              <Skeleton width={110} height={9} />
            </View>
          </View>
        )}
      </View>

      {strip.data?.items.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.chipsRow, !(inside && inside.channels.length > 1) && styles.ruled]}
          contentContainerStyle={styles.chips}
        >
          {strip.data.items.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => router.push(`/market/${m.id}`)}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
              accessibilityRole="link"
              accessibilityLabel={`${m.shortTitle || m.title}, ${m.status === "resolved" ? `resolved ${m.resolution.outcome ?? "void"}` : `Yes ${price(m.yesPrice)}`}`}
            >
              <Text style={styles.chipTitle} numberOfLines={1}>
                {m.shortTitle || m.title}
              </Text>
              <Text style={styles.chipPrice}>
                {m.status === "resolved"
                  ? (m.resolution.outcome ?? "Void")
                  : price(m.yesPrice)}
              </Text>
              {m.status !== "resolved" && m.change ? (
                <Text
                  style={[
                    styles.chipChange,
                    { color: m.change > 0 ? color.gain : color.neg },
                  ]}
                >
                  {m.change > 0 ? "▲" : "▼"} {Math.abs(m.change)}¢
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {inside && inside.channels.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.channelRow, styles.ruled]}
          contentContainerStyle={styles.channels}
        >
          {inside.channels.map((c) => {
            const on = c.id === channel;
            return (
              <Pressable
                key={c.id}
                onPress={() => setPicked(c.id)}
                style={[styles.channel, on && styles.channelOn]}
                accessibilityRole="tab"
                accessibilityLabel={`${c.id} channel${c.unread ? `, ${c.unread} unread` : ""}`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.channelText, on && styles.channelTextOn]}>
                  # {c.id}
                </Text>
                {c.unread && !on ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() =>
          scroller.current?.scrollToEnd({ animated: false })
        }
        keyboardShouldPersistTaps="handled"
      >
        {r && !inside ? (
          <View style={styles.locked}>
            <LockIcon size={22} weight="fill" color={color.muted} />
            <Text style={styles.lockedTitle}>{r.name} is invite only</Text>
            <Text style={styles.lockedBody}>
              {r.requested
                ? `You asked to join. ${r.owner.name} approves new members.`
                : `Request to join — ${r.owner.name} approves new members.`}
            </Text>
          </View>
        ) : !r || messages.isPending ? (
          <View style={{ gap: space[4], paddingVertical: space[3] }} accessibilityLabel="Loading messages" accessibilityRole="progressbar">
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.msg}>
                <Skeleton width={32} height={32} round />
                <View style={{ flex: 1, gap: 7 }}>
                  <Skeleton width={140} height={11} />
                  <Skeleton height={13} />
                </View>
              </View>
            ))}
          </View>
        ) : messages.isError && !items.length ? (
          <Notice
            title="Messages didn't load"
            body={messages.error.message}
            action={{ label: "Try again", onPress: () => messages.refetch() }}
          />
        ) : items.length || here.length ? (
          <>
            {items.map((m, i) => (
              <View key={m.id}>
                {i === 0 || dayOf(items[i - 1]!.at) !== dayOf(m.at) ? (
                  <DayRule label={dayOf(m.at)} />
                ) : null}
                <MessageRow message={m} market={m.marketId ? marketOf.get(m.marketId) : undefined} />
              </View>
            ))}
            {here.map((p, i) => (
              <View key={p.clientId}>
                {(i === 0 && !items.length) || (i === 0 && dayOf(items.at(-1)!.at) !== dayOf(p.at)) ? (
                  <DayRule label={dayOf(p.at)} />
                ) : null}
                <PendingRow
                  pending={p}
                  name={me?.user.displayName ?? "You"}
                  avatarUrl={me?.user.avatarUrl}
                  onRetry={() => deliver(p)}
                  onDiscard={() => setPending((all) => all.filter((x) => x.clientId !== p.clientId))}
                />
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.empty}>
            Nothing in #{channel} yet. {member ? "Start it off." : ""}
          </Text>
        )}
      </ScrollView>

      <View
        style={[
          styles.composer,
          { paddingBottom: Math.max(insets.bottom, space[3]) + 4 },
        ]}
      >
        {!r ? null : member && inside ? (
          <>
            {linked ? (
              <View style={styles.linkedChip}>
                <Text style={styles.linkedText} numberOfLines={1}>
                  {linked.shortTitle || linked.title}
                </Text>
                <Text style={styles.linkedPrice}>Yes {price(linked.yesPrice)}</Text>
                <Pressable
                  onPress={() => setLinked(null)}
                  hitSlop={8}
                  style={styles.linkedRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the linked market"
                >
                  <XIcon size={11} weight="bold" color="#c9cfcb" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.inputBox}>
              <Pressable
                onPress={() => setLinking(true)}
                hitSlop={4}
                style={({ pressed }) => [styles.circle36, pressed && styles.circlePressed]}
                accessibilityRole="button"
                accessibilityLabel="Link a market"
              >
                <PlusIcon size={16} weight="bold" color={color.muted} />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={`Message ${r.name}`}
                placeholderTextColor={color.muted}
                selectionColor={color.pos}
                cursorColor={color.pos}
                multiline
                maxLength={4000}
                style={styles.input}
                accessibilityLabel={`Message ${r.name}`}
              />
              <Button
                onPress={send}
                disabled={!canSend}
                style={styles.send}
                icon={<PaperPlaneTiltIcon size={15} weight="fill" color={PRIMARY_INK} />}
                accessibilityLabel="Send"
              />
            </View>
          </>
        ) : r.requested ? (
          <Text style={styles.waiting}>
            You asked to join. The room’s moderators will let you in.
          </Text>
        ) : (
          <>
            {joinProblem ? <Text style={styles.problem}>{joinProblem}</Text> : null}
            <Button
              size="lg"
              label={
                r.privacy === "Public" ? `Join ${r.name}` : "Request to join"
              }
              onPress={join}
              loading={joining}
            />
          </>
        )}
      </View>

      {inside ? <RoomMenuSheet open={menu} room={inside} onClose={() => setMenu(false)} /> : null}
      <MarketPickerSheet
        open={linking}
        title="Link a market"
        onClose={() => setLinking(false)}
        onPick={(m) => {
          setLinked(m);
          setLinking(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function DayRule({ label }: { label: string }) {
  return (
    <View style={styles.day}>
      <View style={styles.rule} />
      <Text style={styles.dayText}>{label}</Text>
      <View style={styles.rule} />
    </View>
  );
}

function Holding({ outcome, shares }: { outcome: "Yes" | "No"; shares: number }) {
  const yes = outcome === "Yes";
  return (
    <View style={[styles.hold, { backgroundColor: yes ? "rgba(181, 230, 161, 0.13)" : "rgba(239, 138, 109, 0.18)" }]}>
      <Text style={[styles.holdText, { color: yes ? color.pos : "#ef8a6d" }]}>
        {outcome} · {Math.round(shares).toLocaleString("en-US")}
      </Text>
    </View>
  );
}

function MessageRow({ message: m, market }: { message: Message; market?: MarketDTO }) {
  if (m.kind === "join")
    return (
      <Text style={styles.system}>
        {m.author.isYou ? "You" : m.author.name}{" "}
        {m.with?.length ? `added ${m.with.length} ${m.with.length === 1 ? "person" : "people"}` : "joined"} · {time(m.at)}
      </Text>
    );
  if (m.deleted)
    return (
      <View style={styles.msg}>
        <View style={{ width: 32 }} />
        <Text style={styles.deleted}>Message deleted</Text>
      </View>
    );
  return (
    <View style={styles.msg}>
      <Pressable
        onPress={() => openTrader(m.author.handle, m.author.isYou)}
        accessibilityRole="link"
        accessibilityLabel={`${m.author.name}'s profile`}
      >
        <Avatar url={m.author.avatarUrl} size={32} />
      </Pressable>
      <View style={styles.msgBody}>
        <View style={styles.msgHead}>
          <Text style={styles.msgName}>{m.author.name}</Text>
          {m.holdings.map((h) => (
            <Holding key={h.outcome} outcome={h.outcome} shares={h.shares} />
          ))}
          <Text style={styles.msgTime}>{time(m.at)}</Text>
        </View>
        {m.text ? (
          <Text style={styles.msgText}>
            {m.text}
            {m.editedAt ? <Text style={styles.edited}> (edited)</Text> : null}
          </Text>
        ) : null}
        {m.marketId ? <LinkedMarket slug={m.marketId} market={market} /> : null}
        {m.replies ? (
          <Text style={styles.replies}>
            {m.replies.count} {m.replies.count === 1 ? "reply" : "replies"} ·
            last {time(m.replies.lastAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PendingRow({
  pending: p,
  name,
  avatarUrl,
  onRetry,
  onDiscard,
}: {
  pending: Pending;
  name: string;
  avatarUrl?: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={styles.msg} accessibilityLabel={p.failed ? "Message not sent" : "Sending message"}>
      {avatarUrl ? <Avatar url={avatarUrl} size={32} /> : <View style={styles.avatarGap} />}
      <View style={styles.msgBody}>
        <View style={styles.msgHead}>
          <Text style={styles.msgName}>{name}</Text>
          <Text style={styles.msgTime}>{p.failed ? time(p.at) : "Sending…"}</Text>
        </View>
        <View style={{ opacity: 0.6, gap: 3 }}>
          {p.text ? <Text style={styles.msgText}>{p.text}</Text> : null}
          {p.market ? <LinkedMarket slug={p.market.id} market={p.market} /> : null}
        </View>
        {p.failed ? (
          <View style={styles.failed}>
            <WarningCircleIcon size={14} weight="fill" color="#f59c83" />
            <Text style={styles.failedText}>Not sent · </Text>
            <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry sending">
              <Text style={[styles.failedText, styles.failedAction]}>Retry</Text>
            </Pressable>
            <Text style={styles.failedText}> · </Text>
            <Pressable onPress={onDiscard} hitSlop={8} accessibilityRole="button" accessibilityLabel="Discard message">
              <Text style={[styles.failedText, styles.failedAction]}>Discard</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A market shared in a message: what it is, where, and its Yes price. */
function LinkedMarket({ slug, market: m }: { slug: string; market?: MarketDTO }) {
  const venues = useVenues();
  if (!m)
    return (
      <View style={styles.card}>
        <Skeleton width="70%" height={12} />
      </View>
    );
  const resolved = m.status === "resolved";
  const when = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <Pressable
      onPress={() => router.push(`/market/${slug}`)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="link"
      accessibilityLabel={`${m.shortTitle || m.title}, ${resolved ? `resolved ${m.resolution.outcome ?? "void"}` : `Yes ${price(m.yesPrice)}`}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {m.shortTitle || m.title}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {venues.get(m.venueId)?.name ?? m.venueId} · {resolved ? "resolved" : m.status === "open" ? `closes ${when}` : m.status}
        </Text>
      </View>
      <View style={styles.cardPrice}>
        <Text style={styles.cardPriceText}>{resolved ? (m.resolution.outcome ?? "Void") : `Yes ${price(m.yesPrice)}`}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    paddingLeft: space[2],
    paddingRight: space[3],
  },
  circle40: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  circle36: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  circlePressed: { backgroundColor: color.card },
  roomName: { fontFamily: font.medium, fontSize: 15, color: color.text },
  presence: { flexDirection: "row", alignItems: "center", gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.gain },
  presenceText: {
    flexShrink: 1,
    fontFamily: font.regular,
    fontSize: 11,
    color: color.muted,
    fontVariant: ["tabular-nums"],
  },
  ruled: { borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  chipsRow: { flexGrow: 0 },
  chips: { gap: 6, paddingHorizontal: space[4], paddingTop: 4, paddingBottom: space[3] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  chipPressed: { backgroundColor: "#1b241f" },
  chipTitle: { maxWidth: 110, fontFamily: font.regular, fontSize: 12, color: "#c6cec6" },
  chipPrice: { fontFamily: font.medium, fontSize: 12, color: color.text, fontVariant: ["tabular-nums"] },
  chipChange: { fontFamily: font.regular, fontSize: 11, fontVariant: ["tabular-nums"] },
  channelRow: { flexGrow: 0 },
  channels: { gap: 4, paddingHorizontal: space[3], paddingBottom: space[2] },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  channelOn: { backgroundColor: "#1b241f" },
  channelText: { fontFamily: font.medium, fontSize: 12, color: color.muted },
  channelTextOn: { color: color.text },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.gain },
  messages: { paddingTop: space[2], paddingBottom: 6, flexGrow: 1, justifyContent: "flex-end" },
  day: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 8 },
  rule: { flex: 1, height: 1, backgroundColor: HAIRLINE },
  dayText: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  system: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.muted,
    textAlign: "center",
    paddingHorizontal: space[5],
    paddingVertical: 6,
    fontVariant: ["tabular-nums"],
  },
  msg: { flexDirection: "row", gap: 10, paddingHorizontal: space[4], paddingVertical: space[2] },
  avatarGap: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.neutral300 },
  msgBody: { flex: 1, gap: 3 },
  msgHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  msgName: { fontFamily: font.medium, fontSize: 12, color: color.text },
  hold: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill },
  holdText: { fontFamily: font.medium, fontSize: 10, fontVariant: ["tabular-nums"] },
  msgTime: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  msgText: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.text },
  edited: { fontFamily: font.regular, fontSize: 12, color: color.muted },
  replies: { fontFamily: font.medium, fontSize: 12, color: color.pos, marginTop: 2 },
  deleted: { fontFamily: font.regular, fontSize: 14, fontStyle: "italic", color: color.muted },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    paddingVertical: space[2],
    paddingLeft: space[3],
    paddingRight: space[2],
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  cardPressed: { backgroundColor: color.card },
  cardTitle: { fontFamily: font.medium, fontSize: 13, color: color.text },
  cardSub: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  cardPrice: { paddingVertical: 5, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.pos200 },
  cardPriceText: { fontFamily: font.medium, fontSize: 12, color: color.pos, fontVariant: ["tabular-nums"] },
  failed: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  failedText: { fontFamily: font.medium, fontSize: 12, color: "#f59c83" },
  failedAction: { textDecorationLine: "underline" },
  locked: { alignItems: "center", gap: space[2], paddingHorizontal: space[6], paddingVertical: space[6] },
  lockedTitle: { fontFamily: font.medium, fontSize: 16, color: color.text, textAlign: "center", marginTop: space[1] },
  lockedBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.muted, textAlign: "center" },
  empty: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.muted,
    textAlign: "center",
    padding: space[6],
  },
  composer: { paddingHorizontal: space[4], paddingTop: 10, gap: space[2] },
  problem: { fontFamily: font.regular, fontSize: 13, color: color.neg, textAlign: "center" },
  waiting: { fontFamily: font.regular, fontSize: 13, color: color.muted, textAlign: "center", paddingVertical: space[3] },
  linkedChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 8,
    height: 32,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  linkedText: { flexShrink: 1, fontFamily: font.regular, fontSize: 12, color: "#c6cec6" },
  linkedPrice: { fontFamily: font.medium, fontSize: 12, color: color.pos, fontVariant: ["tabular-nums"] },
  linkedRemove: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.08)" },
  inputBox: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    minHeight: 48,
    paddingLeft: 6,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: 24,
    backgroundColor: "#1b241f",
  },
  input: {
    flex: 1,
    alignSelf: "center",
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text,
    paddingVertical: 8,
    maxHeight: 120,
  },
  send: { width: 38, height: 38, paddingHorizontal: 0 },
});
