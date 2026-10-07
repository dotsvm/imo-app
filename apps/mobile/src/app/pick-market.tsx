/** Choose a market for a new prediction: search open markets, tap one. */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import type { MarketPage } from "@imo/server/dto/api-types";
import { Skeleton } from "~/components/skeleton";
import { updateDraft } from "~/features/compose/draft";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { complement } from "~/lib/market";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";
import { VenueMark } from "~/components/venue-mark";

export default function PickMarket() {
  const insets = useSafeAreaInsets();
  const venues = useVenues();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const markets = useQuery({
    queryKey: ["markets", "pick", search],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", { query: { status: "open", sort: "trending", q: search || undefined, limit: 40 }, signal }),
    placeholderData: (prev) => prev,
  });

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Choose a market</Text>
      </View>
      <View style={styles.search}>
        <MagnifyingGlassIcon size={18} color={color.neutral600} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search markets"
          placeholderTextColor={color.neutral600}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel="Search markets"
        />
      </View>
      {markets.isPending ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={34} height={34} round />
              <View style={styles.rowText}>
                <Skeleton width="75%" height={14} />
                <Skeleton width={140} height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : markets.isError ? (
        <Notice title="Markets didn't load" body={markets.error.message} action={{ label: "Try again", onPress: () => markets.refetch() }} />
      ) : (
        <FlatList
          data={markets.data.items}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + space[5] }}
          ListEmptyComponent={<Notice title="No open markets match" body="Try another word, or a shorter one." />}
          renderItem={({ item: m }) => {
            const v = venues.get(m.venueId);
            return (
              <Pressable
                onPress={() => {
                  updateDraft({ market: m });
                  router.back();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
              >
                <VenueMark venueId={m.venueId} size={34} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {m.shortTitle || m.title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {v?.name ?? m.venueId} · Yes {price(m.yesPrice)} · No {price(complement(m.yesPrice))}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingBottom: space[2] },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.medium, fontSize: text.post + 1, color: color.text },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[3],
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: text.post, color: color.text },
  list: { paddingTop: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  rowPressed: { backgroundColor: color.neutral100 },
  rowText: { flex: 1, gap: 5 },
  rowTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  rowMeta: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700, fontVariant: ["tabular-nums"] },
});
