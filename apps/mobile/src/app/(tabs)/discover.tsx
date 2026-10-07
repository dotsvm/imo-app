/**
 * Discover: search, categories, the featured market (with its recent line
 * and one-tap Yes/No), and every market by the chosen filters.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookmarksSimpleIcon } from "phosphor-react-native/src/icons/BookmarksSimple";
import { FadersHorizontalIcon } from "phosphor-react-native/src/icons/FadersHorizontal";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import type { MarketDTO, MarketPage } from "@imo/server/dto/api-types";
import { Skeleton } from "~/components/skeleton";
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { TopBar } from "~/components/top-bar";
import { DEFAULT_FILTERS, FilterSheet, type Filters, isDefault, marketQuery } from "~/features/discover/filters";
import { compactUsd, MarketRow } from "~/features/discover/market-row";
import { Sparkline } from "~/features/discover/sparkline";
import { Notice } from "~/features/home/notice";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { bestAsk, type Outcome } from "~/lib/market";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

/** The API's categories (src/server/db/schema → CATEGORIES). */
const CATEGORIES = ["All", "Economics", "Politics", "Tech", "Science", "Climate", "Sports", "Crypto", "Culture"] as const;
const PAGE = 30;

export default function Discover() {
  const insets = useSafeAreaInsets();
  const venues = useVenues();
  const [category, setCategory] = useState<string>("All");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [trade, setTrade] = useState<{ market: MarketDTO; outcome: Outcome } | null>(null);
  const bottom = TAB_BAR_HEIGHT + Math.max(insets.bottom, space[3]) + space[5];

  const featured = useQuery({
    queryKey: ["markets", "featured", category],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", { query: { featured: "true", category: category === "All" ? undefined : category, limit: 1 }, signal }).then(
        (p) => p.items[0] ?? null,
      ),
  });
  const markets = useInfiniteQuery({
    queryKey: ["markets", "discover", filters, category],
    queryFn: ({ pageParam, signal }) =>
      api<MarketPage>("/markets", { query: { ...marketQuery(filters, category), limit: PAGE, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
  });
  const items = (markets.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => m.id !== featured.data?.id || !isDefault(filters));
  const venueName = (id: string) => venues.get(id)?.name ?? id;
  const sortLabel = { trending: "TRENDING", volume: "BY VOLUME", closing: "CLOSING SOON", movers: "BIGGEST MOVES" }[filters.sort];

  const header = (
    <View>
      <Pressable onPress={() => router.push("/search")} style={styles.search} accessibilityRole="search" accessibilityLabel="Search markets, traders, rooms">
        <MagnifyingGlassIcon size={17} color={color.neutral600} />
        <Text style={styles.searchText}>Search markets, traders, rooms</Text>
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        {CATEGORIES.map((c) => {
          const on = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.cat, on && styles.catOn]}
              accessibilityRole="tab"
              accessibilityLabel={c}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.catText, on && styles.catTextOn]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {featured.isPending ? (
        <View style={styles.featured}>
          <Skeleton width={120} height={10} />
          <Skeleton height={20} />
          <Skeleton width="70%" height={20} />
          <Skeleton height={64} style={{ borderRadius: radius.card }} />
          <Skeleton height={48} round />
        </View>
      ) : featured.data ? (
        <Featured
          market={featured.data}
          venue={venueName(featured.data.venueId)}
          onTrade={(outcome) => setTrade({ market: featured.data!, outcome })}
        />
      ) : null}

      <View style={styles.listHead}>
        <Text style={styles.listLabel}>{sortLabel}</Text>
        <Pressable
          onPress={() => setFiltering(true)}
          style={({ pressed }) => [styles.filter, !isDefault(filters) && styles.filterOn, pressed && styles.filterPressed]}
          accessibilityRole="button"
          accessibilityLabel={isDefault(filters) ? "Filter markets" : "Filter markets, filters on"}
        >
          <FadersHorizontalIcon size={15} color={color.text} />
          <Text style={styles.filterText}>Filter</Text>
          {!isDefault(filters) ? <View style={styles.filterDot} /> : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <TopBar
        title="Discover"
        showSearch={false}
        extra={{
          label: "Watchlists",
          icon: <BookmarksSimpleIcon size={23} weight="fill" color={color.text} />,
          onPress: () => router.push("/watchlists"),
        }}
      />
      {markets.isError ? (
        <>
          {header}
          <Notice title="Markets didn't load" body={markets.error.message} action={{ label: "Try again", onPress: () => markets.refetch() }} />
        </>
      ) : (
        <FlatList
          data={markets.isPending ? [] : items}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <MarketRow market={item} venue={venueName(item.venueId)} onPress={() => router.push(`/market/${item.id}`)} />
          )}
          contentContainerStyle={{ paddingBottom: bottom }}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (markets.hasNextPage && !markets.isFetchingNextPage) markets.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={markets.isRefetching && !markets.isFetchingNextPage}
              onRefresh={() => {
                markets.refetch();
                featured.refetch();
              }}
              tintColor={color.neutral600}
            />
          }
          ListEmptyComponent={
            markets.isPending ? (
              <View>
                {Array.from({ length: 5 }, (_, i) => (
                  <View key={i} style={styles.rowSkeleton}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width="85%" height={14} />
                      <Skeleton width={150} height={11} />
                    </View>
                    <Skeleton width={40} height={18} />
                  </View>
                ))}
              </View>
            ) : (
              <Notice
                title="No markets match"
                body="Loosen a filter, or pick another category."
                action={!isDefault(filters) ? { label: "Clear filters", onPress: () => setFilters(DEFAULT_FILTERS) } : undefined}
              />
            )
          }
          ListFooterComponent={markets.isFetchingNextPage ? <ActivityIndicator color={color.neutral600} style={{ margin: space[5] }} /> : null}
        />
      )}

      <FilterSheet open={filtering} value={filters} category={category} onApply={setFilters} onClose={() => setFiltering(false)} />
      {trade ? <TradeSheet post={null} market={trade.market} outcome={trade.outcome} onClose={() => setTrade(null)} /> : null}
    </View>
  );
}

function Featured({ market: m, venue, onTrade }: { market: MarketDTO; venue: string; onTrade: (o: Outcome) => void }) {
  const up = m.change > 0;
  const down = m.change < 0;
  const closes = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const open = m.status === "open";
  return (
    <View style={styles.featured}>
      <Text style={styles.featuredLabel}>
        FEATURED · {venue.toUpperCase()}
        {m.featuredLabel ? ` · ${m.featuredLabel.toUpperCase()}` : ""}
      </Text>
      <Pressable onPress={() => router.push(`/market/${m.id}`)} accessibilityRole="link">
        <Text style={styles.featuredTitle}>{m.title}</Text>
      </Pressable>
      {m.series.length > 1 ? <Sparkline points={m.series} /> : null}
      <View style={styles.featuredMeta}>
        <Text style={[styles.metaText, { color: up ? color.pos : down ? color.neg : color.neutral700 }]}>
          {up ? "▲ " : down ? "▼ " : ""}
          {Math.abs(m.change).toFixed(1).replace(/\.0$/, "")}¢ today
        </Text>
        <Text style={styles.metaText}>
          {compactUsd(m.volumeCents)} vol · closes {closes}
        </Text>
      </View>
      {open ? (
        <View style={styles.yesNo}>
          <Pressable onPress={() => onTrade("Yes")} style={({ pressed }) => [styles.side, styles.yes, pressed && styles.sidePressed]} accessibilityRole="button">
            <Text style={[styles.sideText, { color: color.pos }]}>Yes {price(bestAsk(m, "Yes"))}</Text>
          </Pressable>
          <Pressable onPress={() => onTrade("No")} style={({ pressed }) => [styles.side, styles.no, pressed && styles.sidePressed]} accessibilityRole="button">
            <Text style={[styles.sideText, { color: color.neg }]}>No {price(bestAsk(m, "No"))}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    height: 46,
    marginHorizontal: space[4],
    marginTop: space[1],
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral300,
  },
  searchText: { fontFamily: font.regular, fontSize: text.body + 1, color: color.neutral600 },
  cats: { gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  cat: { height: 38, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  catOn: { backgroundColor: "#eceadf" },
  catText: { fontFamily: font.medium, fontSize: text.body, color: color.neutral800 },
  catTextOn: { color: "#0b0d0c" },
  featured: {
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.divider,
  },
  featuredLabel: { fontFamily: font.medium, fontSize: 11, letterSpacing: 1.2, color: color.gold },
  featuredTitle: { fontFamily: font.medium, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: color.text },
  featuredMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  yesNo: { flexDirection: "row", gap: space[2], marginTop: space[1] },
  side: { flex: 1, height: 50, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  yes: { backgroundColor: "#16231a", borderColor: "#3f5a41" },
  no: { backgroundColor: "#24171a", borderColor: "#5a3a34" },
  sidePressed: { transform: [{ translateY: 1 }], opacity: 0.85 },
  sideText: { fontFamily: font.semibold, fontSize: 16, fontVariant: ["tabular-nums"] },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  listLabel: { fontFamily: font.medium, fontSize: 12, letterSpacing: 1.2, color: color.neutral800 },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.neutral400,
  },
  filterOn: { borderColor: color.posLine },
  filterPressed: { backgroundColor: color.neutral300 },
  filterText: { fontFamily: font.medium, fontSize: text.ui, color: color.text },
  filterDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.pos },
  rowSkeleton: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
});
