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
import { MarketRow } from "~/features/discover/market-row";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

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
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <CaretLeftIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Choose a market</Text>
      </View>
      <View style={styles.search}>
        <MagnifyingGlassIcon size={16} weight="bold" color={color.neutral700} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search markets"
          placeholderTextColor={color.neutral600}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          cursorColor={color.pos}
          selectionColor={color.pos}
          style={styles.input}
          accessibilityLabel="Search markets"
        />
      </View>
      {markets.isPending ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={styles.row}>
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
          renderItem={({ item: m }) => (
            <MarketRow
              market={m}
              venue={venues.get(m.venueId)?.name ?? m.venueId}
              variant="search"
              onPress={() => {
                updateDraft({ market: m });
                router.back();
              }}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], paddingBottom: space[2] },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  backPressed: { backgroundColor: color.neutral300 },
  title: { fontFamily: font.medium, fontSize: text.post + 1, color: color.text },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingLeft: space[4],
    paddingRight: space[2],
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
    borderWidth: 1,
    borderColor: color.neutral400,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: text.post, color: color.text, padding: 0 },
  list: { paddingTop: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 11,
  },
  rowText: { flex: 1, gap: 5 },
});
