/** Home → Rooms: your rooms first, then the busiest others, each a tap into the room. */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import type { RoomSummaryDTO } from "@imo/server/dto/api-types";
import { Skeleton } from "~/components/skeleton";
import { RoomTile } from "~/features/rooms/room-tile";
import { api } from "~/lib/api";
import { count } from "~/lib/format";
import { color, font, space, text } from "~/theme/tokens";
import { Notice } from "./notice";

export function RoomsList({ bottomInset, header }: { bottomInset: number; header?: ReactElement }) {
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => api<{ items: RoomSummaryDTO[] }>("/rooms", { query: { limit: 100 }, signal }),
  });
  if (rooms.isPending || rooms.isError)
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        {header}
        {rooms.isPending ? (
          <View accessibilityLabel="Loading rooms" accessibilityRole="progressbar">
            {Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={styles.row}>
                <Skeleton width={44} height={44} style={{ borderRadius: 12 }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="35%" height={11} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Notice title="Rooms didn't load" body={rooms.error.message} action={{ label: "Try again", onPress: () => rooms.refetch() }} />
        )}
      </ScrollView>
    );
  // Yours first; then the rest by who's there now, then size.
  const items = [...rooms.data.items].sort(
    (a, b) => Number(b.role !== null) - Number(a.role !== null) || b.online - a.online || b.memberCount - a.memberCount,
  );
  return (
    <FlatList
      data={items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={rooms.isRefetching} onRefresh={() => rooms.refetch()} tintColor={color.neutral600} />}
      ListEmptyComponent={<Notice title="No rooms yet" body="Start one from the Rooms tab and bring people in." />}
      renderItem={({ item: r }) => (
        <Pressable
          onPress={() => router.push(`/room/${r.id}`)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${r.name}, ${r.memberCount} members${r.online ? `, ${r.online} online` : ""}`}
        >
          <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} online={r.online > 0} muted={r.role === null} />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {count(r.memberCount)} members{r.online ? ` · ${count(r.online)} online` : ""}
              {r.role ? "" : " · Not joined"}
            </Text>
          </View>
          <CaretRightIcon size={16} color={color.neutral600} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  pressed: { backgroundColor: color.neutral100 },
  text: { flex: 1, gap: 3 },
  name: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  meta: { fontFamily: font.regular, fontSize: 13, color: color.neutral700, fontVariant: ["tabular-nums"] },
});
