/**
 * A room: its markets' live prices, its channels, and the conversation as
 * team-chat rows (avatar, name, what they hold, time, then the words) —
 * not bubbles. Members write; everyone else can join or ask to.
 * New messages arrive by polling every few seconds while the room is open.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { PaperPlaneRightIcon } from "phosphor-react-native/src/icons/PaperPlaneRight";
import type { MarketPage, MessagesDTO, RoomDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { Notice } from "~/features/home/notice";
import { RoomTile } from "~/features/rooms/room-tile";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { price } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Message = MessagesDTO["items"][number];

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
  const scroller = useRef<ScrollView>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const room = useQuery({
    queryKey: ["room", id],
    queryFn: ({ signal }) => api<RoomDTO>(`/rooms/${id}`, { signal }),
  });
  const r = room.data;
  // A private room you're not in comes back locked: who it is, not what's said.
  const inside = r && "channels" in r ? r : undefined;
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
  const markets = useQuery({
    queryKey: ["markets", "byIds", r?.watchlist.join(",")],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { ids: r!.watchlist.join(","), limit: r!.watchlist.length },
        signal,
      }),
    enabled: !!r?.watchlist.length,
  });

  // Reading a channel marks it read.
  const items = messages.data?.items ?? [];
  const lastId = items.at(-1)?.id;
  useEffect(() => {
    if (!member || !lastId) return;
    api(`/rooms/${id}/channels/${channel}/read`, { method: "POST", body: {} })
      .then(() => queryClient.invalidateQueries({ queryKey: ["rooms"] }))
      .catch(() => undefined);
  }, [member, lastId, id, channel, queryClient]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setProblem(null);
    try {
      await api(`/rooms/${id}/channels/${channel}/messages`, {
        body: {
          text: body,
          clientId: `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      setDraft("");
      await messages.refetch();
      requestAnimationFrame(() =>
        scroller.current?.scrollToEnd({ animated: true }),
      );
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Your message didn't send. Try again.",
      );
    } finally {
      setSending(false);
    }
  }

  async function join() {
    if (!r) return;
    setJoining(true);
    try {
      if (r.privacy === "Public")
        await api(`/rooms/${id}/join`, { method: "PUT" });
      else await api(`/rooms/${id}/requests`, { method: "POST", body: {} });
      await Promise.all([
        room.refetch(),
        queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      ]);
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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        {r ? (
          <>
            <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} size={38} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.roomName} numberOfLines={1}>
                {r.name}
              </Text>
              <View style={styles.presence}>
                {r.online > 0 ? <View style={styles.onlineDot} /> : null}
                <Text style={styles.small}>
                  {r.online > 0 ? `${r.online} online · ` : ""}
                  {r.memberCount.toLocaleString("en-US")} members
                </Text>
              </View>
            </View>
          </>
        ) : (
          <Skeleton width={160} height={16} />
        )}
      </View>

      {markets.data?.items.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chips}
        >
          {markets.data.items.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => router.push(`/market/${m.id}`)}
              style={styles.chip}
              accessibilityRole="link"
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
                    { color: m.change > 0 ? color.pos : color.neg },
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
          style={styles.channelRow}
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
          <Text style={styles.empty}>
            This room is invite only. Ask to join to read along.
          </Text>
        ) : !r || messages.isPending ? (
          <View style={{ gap: space[5], padding: space[4] }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.msg}>
                <Skeleton width={32} height={32} round />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width={140} height={12} />
                  <Skeleton height={13} />
                </View>
              </View>
            ))}
          </View>
        ) : items.length ? (
          items.map((m, i) => (
            <View key={m.id}>
              {i === 0 || dayOf(items[i - 1]!.at) !== dayOf(m.at) ? (
                <View style={styles.day}>
                  <View style={styles.rule} />
                  <Text style={styles.dayText}>{dayOf(m.at)}</Text>
                  <View style={styles.rule} />
                </View>
              ) : null}
              <MessageRow message={m} />
            </View>
          ))
        ) : (
          <Text style={styles.empty}>
            Nothing in #{channel} yet. {member ? "Start it off." : ""}
          </Text>
        )}
      </ScrollView>

      <View
        style={[
          styles.composer,
          { paddingBottom: Math.max(insets.bottom, space[3]) },
        ]}
      >
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {!r ? null : member ? (
          <View style={styles.inputBox}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${r.name}`}
              placeholderTextColor={color.neutral600}
              multiline
              maxLength={4000}
              style={styles.input}
              accessibilityLabel={`Message ${r.name}`}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              style={[styles.send, !draft.trim() && styles.sendOff]}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              {sending ? (
                <ActivityIndicator size="small" color={PRIMARY_INK} />
              ) : (
                <PaperPlaneRightIcon
                  size={17}
                  weight="fill"
                  color={PRIMARY_INK}
                />
              )}
            </Pressable>
          </View>
        ) : r.requested ? (
          <Text style={styles.small}>
            You asked to join. The room’s moderators will let you in.
          </Text>
        ) : (
          <Button
            size="lg"
            label={
              r.privacy === "Public" ? `Join ${r.name}` : "Request to join"
            }
            onPress={join}
            loading={joining}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageRow({ message: m }: { message: Message }) {
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
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.msgHead}>
          <Text style={styles.msgName}>{m.author.name}</Text>
          {m.holdings.map((h) => (
            <View
              key={h.outcome}
              style={[
                styles.hold,
                {
                  backgroundColor:
                    h.outcome === "Yes" ? color.pos200 : color.neg200,
                },
              ]}
            >
              <Text
                style={[
                  styles.holdText,
                  { color: h.outcome === "Yes" ? color.pos : color.neg },
                ]}
              >
                {h.outcome} · {Math.round(h.shares).toLocaleString("en-US")}
              </Text>
            </View>
          ))}
          <Text style={styles.msgTime}>{time(m.at)}</Text>
        </View>
        <Text style={styles.msgText}>
          {m.text}
          {m.editedAt ? <Text style={styles.small}> (edited)</Text> : null}
        </Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingBottom: space[3],
  },
  back: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  roomName: { fontFamily: font.medium, fontSize: 16, color: color.text },
  presence: { flexDirection: "row", alignItems: "center", gap: 5 },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#5bc46a",
  },
  small: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  chipsRow: { flexGrow: 0 },
  chips: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: color.neutral100,
    maxWidth: 260,
  },
  chipTitle: {
    flexShrink: 1,
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral800,
  },
  chipPrice: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  chipChange: {
    fontFamily: font.medium,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  channelRow: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  channels: {
    gap: space[1],
    paddingHorizontal: space[3],
    paddingBottom: space[2],
  },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  channelOn: { backgroundColor: color.neutral300 },
  channelText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.neutral700,
  },
  channelTextOn: { color: color.text },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#7fd47a",
  },
  messages: {
    paddingVertical: space[3],
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    marginVertical: space[3],
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.neutral400,
  },
  dayText: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
  msg: {
    flexDirection: "row",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 9,
  },
  msgHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  msgName: { fontFamily: font.semibold, fontSize: text.ui, color: color.text },
  hold: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.chip },
  holdText: {
    fontFamily: font.medium,
    fontSize: 10.5,
    fontVariant: ["tabular-nums"],
  },
  msgTime: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral600,
    fontVariant: ["tabular-nums"],
  },
  msgText: {
    fontFamily: font.regular,
    fontSize: text.post,
    lineHeight: 22,
    color: color.text,
  },
  replies: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.pos,
    marginTop: 2,
  },
  deleted: {
    fontFamily: font.regular,
    fontSize: text.body,
    fontStyle: "italic",
    color: color.neutral600,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: text.body,
    color: color.neutral700,
    textAlign: "center",
    padding: space[6],
  },
  composer: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    gap: space[2],
  },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 50,
    paddingLeft: space[4],
    paddingRight: 6,
    borderRadius: radius.pill,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral300,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: text.post,
    color: color.text,
    paddingVertical: 12,
    maxHeight: 120,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
  },
  sendOff: { opacity: 0.4 },
});
