/** Home → Trending: open markets in the server's trending order, with price and day's move. */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { MarketPage } from "@imo/server/dto/api-types";
import { Skeleton } from "~/components/skeleton";
import { MarketRow } from "~/features/discover/market-row";
import { api } from "~/lib/api";
import { useVenues } from "~/lib/venues";
import { color, font, space, text } from "~/theme/tokens";
import { Notice } from "./notice";

export function TrendingList({ bottomInset, header }: { bottomInset: number; header?: ReactElement }) {
  const venues = useVenues();
  const markets = useQuery({
    queryKey: ["markets", "trending"],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { sort: "trending", status: "open", limit: 40 }, signal }),
    staleTime: 30_000,
  });
  if (markets.isPending || markets.isError)
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        {header}
        {markets.isPending ? (
          <RowsSkeleton />
        ) : (
          <Notice title="Markets didn't load" body={markets.error.message} action={{ label: "Try again", onPress: () => markets.refetch() }} />
        )}
      </ScrollView>
    );
  return (
    <FlatList
      data={markets.data.items}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      refreshControl={<RefreshControl refreshing={markets.isRefetching} onRefresh={() => markets.refetch()} tintColor={color.neutral600} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<Notice title="No open markets" body="Markets show up here as venues list them." />}
      renderItem={({ item: m }) => (
        <MarketRow market={m} venue={venues.get(m.venueId)?.name ?? m.venueId} onPress={() => router.push(`/market/${m.id}`)} />
      )}
    />
  );
}

function RowsSkeleton() {
  return (
    <View accessibilityLabel="Loading markets" accessibilityRole="progressbar">
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.text}>
            <Skeleton width="80%" height={14} />
            <Skeleton width={110} height={11} />
          </View>
          <Skeleton width={44} height={18} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  text: { flex: 1, gap: 5 },
  title: { fontFamily: font.medium, fontSize: text.post, lineHeight: 21, color: color.text },
  meta: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  figure: { alignItems: "flex-end", gap: 4 },
  price: { fontFamily: font.semibold, fontSize: 18, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.regular, fontSize: text.ui, fontVariant: ["tabular-nums"] },
});
