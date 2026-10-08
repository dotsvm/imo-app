/**
 * Live rooms: rooms with people in them right now, busiest first, each a
 * chip with its picture, name and how many are online. When nobody's online
 * anywhere it shows your own rooms instead; with no rooms at all, nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RoomSummaryDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";
import { color, font, radius, space } from "~/theme/tokens";

const LIVE = "#ec8b78";
const CHIP = "#121815";

export function LiveRooms() {
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => api<{ items: RoomSummaryDTO[] }>("/rooms", { query: { limit: 100 }, signal }),
  });
  const all = rooms.data?.items ?? [];
  const live = all.filter((r) => r.online > 0).sort((a, b) => b.online - a.online);
  const mine = all.filter((r) => r.role !== null);
  const shown = live.length ? live : mine;
  if (!shown.length) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          {live.length ? <View style={styles.liveDot} /> : null}
          <Text style={styles.title}>{live.length ? "Live rooms" : "Your rooms"}</Text>
        </View>
        <Pressable onPress={() => router.navigate("/rooms")} hitSlop={8} accessibilityRole="button">
          <Text style={styles.all}>See all</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {shown.slice(0, 10).map((r) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/room/${r.id}`)}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            accessibilityRole="button"
            accessibilityLabel={live.length ? `${r.name}, ${r.online} online` : `${r.name}, ${r.memberCount} members`}
          >
            <View>
              {r.avatarUrl ? (
                <Image source={{ uri: r.avatarUrl }} style={styles.pic} contentFit="cover" />
              ) : (
                <View style={[styles.pic, styles.symbol, { backgroundColor: r.color }]}>
                  <Text style={styles.symbolText}>{r.symbol}</Text>
                </View>
              )}
              {r.online > 0 ? <View style={styles.picDot} /> : null}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={[styles.count, !live.length && styles.countQuiet]}>{live.length ? r.online : r.memberCount}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, paddingTop: 14 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LIVE },
  title: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  all: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  row: { gap: space[2], paddingHorizontal: 20, paddingBottom: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: radius.pill,
    backgroundColor: CHIP,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  chipPressed: { backgroundColor: "#161b18" },
  pic: { width: 32, height: 32, borderRadius: 16 },
  symbol: { alignItems: "center", justifyContent: "center" },
  symbolText: { fontFamily: font.semibold, fontSize: 12, color: "#0b1410" },
  picDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: LIVE,
    borderWidth: 2,
    borderColor: CHIP,
  },
  name: { fontFamily: font.medium, fontSize: 13, color: color.text, maxWidth: 140 },
  count: { fontFamily: font.regular, fontSize: 12, color: LIVE, fontVariant: ["tabular-nums"] },
  countQuiet: { color: color.neutral700 },
});
