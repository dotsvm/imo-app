/**
 * Rooms: the ones you're in (latest word from #general, unread count, who's
 * online), most recent first, and rooms to find, with Join or Request.
 * Search narrows both.
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type { MessagesDTO, RoomSummaryDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { tabBarSpace } from "~/components/tab-bar";
import { Notice } from "~/features/home/notice";
import { RoomTile } from "~/features/rooms/room-tile";
import { api } from "~/lib/api";
import { color, font, radius, space } from "~/theme/tokens";

const clock = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function Rooms() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: ({ signal }) =>
      api<{ items: RoomSummaryDTO[] }>("/rooms", {
        query: { limit: 100 },
        signal,
      }),
  });
  const all = rooms.data?.items ?? [];
  const term = q.trim().toLowerCase();
  const match = (r: RoomSummaryDTO) =>
    !term ||
    r.name.toLowerCase().includes(term) ||
    r.description.toLowerCase().includes(term);
  const mine = all.filter((r) => r.role && !r.archived && match(r));
  const others = all.filter((r) => !r.role && !r.archived && match(r));

  // The latest message in each of your rooms' #general, for the preview line.
  const latest = useQueries({
    queries: mine.map((r) => ({
      queryKey: ["rooms", r.id, "latest"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<MessagesDTO>(`/rooms/${r.id}/channels/general/messages`, {
          query: { limit: 1 },
          signal,
        }),
      staleTime: 30_000,
    })),
  });

  // Most recent conversation first; rooms whose latest word hasn't loaded keep their place after.
  const yours = mine
    .map((r, i) => ({ room: r, last: latest[i]?.data?.items.at(-1) }))
    .sort((a, b) => (b.last ? Date.parse(b.last.at) : 0) - (a.last ? Date.parse(a.last.at) : 0));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Rooms
        </Text>
        <Button
          onPress={() => router.push("/new-room")}
          icon={<PlusIcon size={16} weight="bold" color={PRIMARY_INK} />}
          style={styles.add}
          accessibilityLabel="Create room"
        />
      </View>
      <View style={styles.search}>
        <MagnifyingGlassIcon size={16} weight="bold" color={color.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search rooms"
          placeholderTextColor={color.muted}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search rooms"
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom:
            tabBarSpace(insets.bottom) + space[5],
        }}
        refreshControl={
          <RefreshControl
            refreshing={rooms.isRefetching}
            onRefresh={() => rooms.refetch()}
            tintColor={color.neutral600}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {rooms.isPending ? (
          <View accessibilityLabel="Loading rooms" accessibilityRole="progressbar">
            <View style={styles.sectionSkeleton}>
              <Skeleton width={72} height={10} />
            </View>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.row}>
                <Skeleton width={48} height={48} style={{ borderRadius: 16 }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton width={130} height={13} />
                  <Skeleton width="78%" height={11} />
                </View>
              </View>
            ))}
          </View>
        ) : rooms.isError ? (
          <Notice
            title="Rooms didn't load"
            body={rooms.error.message}
            action={{ label: "Try again", onPress: () => rooms.refetch() }}
          />
        ) : (
          <>
            {yours.length ? (
              <Text style={styles.section}>Your rooms</Text>
            ) : null}
            {yours.map(({ room: r, last }) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/room/${r.id}`)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}${r.unread ? `, ${r.unread} unread` : ""}${r.online ? `, ${r.online} online` : ""}`}
              >
                <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} online={r.online > 0} size={48} />
                <View style={styles.rowText}>
                  <View style={styles.line}>
                    <Text style={styles.name} numberOfLines={1}>
                      {r.name}
                    </Text>
                    {last ? <Text style={styles.time}>{clock(last.at)}</Text> : null}
                  </View>
                  <View style={styles.line}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {last ? preview(last) : r.description || `${r.memberCount.toLocaleString("en-US")} members`}
                    </Text>
                    {r.unread ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{r.unread > 99 ? "99+" : r.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            ))}

            {others.length ? (
              <Text style={styles.section}>Discover</Text>
            ) : null}
            {others.map((r) => (
              <DiscoverRow key={r.id} room={r} />
            ))}
            {!mine.length && !others.length ? (
              <Notice
                title={term ? "No rooms match" : "No rooms yet"}
                body={
                  term
                    ? "Try another word."
                    : "Start one with +, around the markets you follow."
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** "Jordan: Bought 180 Yes…", a join line, or a linked market with no words. */
function preview(m: MessagesDTO["items"][number]) {
  const who = m.author.isYou ? "You" : m.author.name.split(" ")[0];
  if (m.kind === "join") return `${who} joined`;
  if (m.deleted) return `${who}: message deleted`;
  return `${who}: ${m.text || (m.marketId ? "shared a market" : "")}`;
}

function DiscoverRow({ room: r }: { room: RoomSummaryDTO }) {
  const queryClient = useQueryClient();
  const open = r.privacy === "Public";
  const [state, setState] = useState<"none" | "busy" | "requested">(
    r.requested ? "requested" : "none",
  );
  async function join() {
    setState("busy");
    try {
      if (open) {
        await api(`/rooms/${r.id}/join`, { method: "PUT" });
        await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      } else {
        await api(`/rooms/${r.id}/requests`, { method: "POST", body: {} });
        setState("requested");
      }
    } catch {
      setState("none");
    }
  }
  return (
    // The room opens from its name; Join sits beside it, never inside another button.
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push(`/room/${r.id}`)}
        style={({ pressed }) => [styles.openRoom, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${r.name}, ${r.memberCount} members`}
      >
        <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} size={48} muted />
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.memberCount.toLocaleString("en-US")} {r.memberCount === 1 ? "member" : "members"}
            {r.postsToday ? ` · ${r.postsToday} posts today` : ""}
          </Text>
        </View>
      </Pressable>
      <Button
        size="xs"
        style={styles.join}
        variant={state === "requested" ? "quiet" : "primary"}
        label={state === "requested" ? "Requested" : open ? "Join" : "Request"}
        onPress={join}
        loading={state === "busy"}
        disabled={state === "requested"}
        accessibilityLabel={`${open ? "Join" : "Request to join"} ${r.name}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: 20,
    paddingRight: space[4],
    marginBottom: space[3],
  },
  title: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 26,
    letterSpacing: -0.52,
    color: color.text,
  },
  add: { width: 40, height: 40, paddingHorizontal: 0 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    marginHorizontal: space[4],
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.text,
  },
  section: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.muted,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sectionSkeleton: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  pressed: { backgroundColor: color.neutral100 },
  openRoom: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rowText: { flex: 1, gap: 2 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  name: { flexShrink: 1, fontFamily: font.medium, fontSize: 15, color: color.text },
  preview: {
    flexShrink: 1,
    fontFamily: font.regular,
    fontSize: 13,
    color: "#c6cec6",
  },
  meta: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.muted,
    fontVariant: ["tabular-nums"],
  },
  time: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.muted,
    fontVariant: ["tabular-nums"],
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.gain,
  },
  badgeText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: "#0c100e",
    fontVariant: ["tabular-nums"],
  },
  join: { height: 32, paddingHorizontal: 14 },
});
