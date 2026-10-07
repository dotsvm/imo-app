/**
 * Rooms: the ones you're in (latest word from #general, unread count) and
 * public rooms to find, with Join or Request. Search narrows both.
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
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { Notice } from "~/features/home/notice";
import { RoomTile } from "~/features/rooms/room-tile";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Rooms</Text>
        <Pressable
          onPress={() => router.push("/new-room")}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="New room"
        >
          <PlusIcon size={20} weight="bold" color={PRIMARY_INK} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <MagnifyingGlassIcon size={16} color={color.neutral600} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search rooms"
          placeholderTextColor={color.neutral600}
          style={styles.input}
          autoCorrect={false}
          accessibilityLabel="Search rooms"
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom:
            TAB_BAR_HEIGHT + Math.max(insets.bottom, space[3]) + space[5],
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
          <View style={styles.pad}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.row}>
                <Skeleton width={44} height={44} style={{ borderRadius: 12 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width={120} height={14} />
                  <Skeleton width="80%" height={11} />
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
            {mine.length ? (
              <Text style={styles.section}>Your rooms</Text>
            ) : null}
            {mine.map((r, i) => {
              const last = latest[i]?.data?.items.at(-1);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/room/${r.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}${r.unread ? `, ${r.unread} unread` : ""}`}
                >
                  <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} online={r.online > 0} />
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text
                      style={[
                        styles.preview,
                        r.unread > 0 && styles.previewUnread,
                      ]}
                      numberOfLines={1}
                    >
                      {last
                        ? `${last.author.name.split(" ")[0]}: ${last.text}`
                        : r.description}
                    </Text>
                  </View>
                  <View style={styles.side}>
                    {last ? (
                      <Text style={styles.time}>{clock(last.at)}</Text>
                    ) : null}
                    {r.unread ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {r.unread > 99 ? "99+" : r.unread}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}

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
        <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} muted />
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {r.memberCount.toLocaleString("en-US")} members
            {r.postsToday ? ` · ${r.postsToday} posts today` : ""}
            {!open ? " · invite only" : ""}
          </Text>
        </View>
      </Pressable>
      <Button
        size="sm"
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
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    marginBottom: space[3],
  },
  title: {
    fontFamily: font.medium,
    fontSize: 28,
    letterSpacing: -0.8,
    color: color.text,
  },
  add: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.55), 0 6px 14px -6px rgba(0,0,0,0.6)",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    height: 44,
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral300,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: text.body + 1,
    color: color.text,
  },
  pad: { paddingTop: space[3] },
  section: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral700,
    paddingHorizontal: space[4],
    paddingTop: space[5],
    paddingBottom: space[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 11,
  },
  pressed: { backgroundColor: color.neutral100 },
  openRoom: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rowText: { flex: 1, gap: 4 },
  name: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  preview: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neutral700,
  },
  previewUnread: { color: color.neutral800 },
  side: { alignItems: "flex-end", gap: 6, minWidth: 34 },
  time: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral600,
    fontVariant: ["tabular-nums"],
  },
  badge: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7fd47a",
  },
  badgeText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: PRIMARY_INK,
    fontVariant: ["tabular-nums"],
  },
});
