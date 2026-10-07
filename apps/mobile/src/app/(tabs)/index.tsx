import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Platform, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Fab } from "~/components/fab";
import { SegmentedTabs } from "~/components/segmented-tabs";
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { Ticker } from "~/components/ticker";
import { TopBar } from "~/components/top-bar";
import { useConfig } from "~/features/auth/auth";
import { FeedSkeleton } from "~/features/feed/feed-skeleton";
import { PostCard } from "~/features/feed/post-card";
import { type FeedEntry, useFeed } from "~/features/feed/use-feed";
import { recordLine, useRecords } from "~/features/feed/use-records";
import { Notice } from "~/features/home/notice";
import { TradersList } from "~/features/home/traders-list";
import { TrendingList } from "~/features/home/trending-list";
import { TradeSheet } from "~/features/trade/trade-sheet";
import type { Outcome } from "~/lib/market";
import { useVenues } from "~/lib/venues";
import { color, space } from "~/theme/tokens";

/** Home's views, as on the web: two feeds, the leaderboard, and trending markets. */
type View_ = "for-you" | "following" | "traders" | "trending";
const VIEWS = [
  { id: "for-you", label: "For you" },
  { id: "following", label: "Following" },
  { id: "traders", label: "Traders" },
  { id: "trending", label: "Trending" },
] as const satisfies readonly { id: View_; label: string }[];

export default function Home() {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>("for-you");
  const bottom = TAB_BAR_HEIGHT + Math.max(insets.bottom, space[3]);

  const [trade, setTrade] = useState<{ entry: FeedEntry; outcome: Outcome } | null>(null);
  const onTrade = useCallback((entry: FeedEntry, outcome: Outcome) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTrade({ entry, outcome });
  }, []);

  return (
    <View style={styles.screen}>
      <TopBar onSearch={() => router.push("/search")} />
      <SegmentedTabs options={VIEWS} value={view} onChange={setView} />
      <Ticker />
      {view === "traders" ? (
        <TradersList bottomInset={bottom + space[5]} />
      ) : view === "trending" ? (
        <TrendingList bottomInset={bottom + space[5]} />
      ) : (
        <Feed key={view} feed={view} onTrade={onTrade} bottomInset={bottom + 88} />
      )}
      <Fab bottom={bottom + space[4]} onPress={() => router.push("/compose")} />
      {trade ? (
        <TradeSheet post={trade.entry.post} market={trade.entry.market} outcome={trade.outcome} onClose={() => setTrade(null)} />
      ) : null}
    </View>
  );
}

function Feed({
  feed,
  onTrade,
  bottomInset,
}: {
  feed: "for-you" | "following";
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
  bottomInset: number;
}) {
  const query = useFeed(feed);
  const venues = useVenues();
  const records = useRecords();
  // The demo dataset describes one fixed moment; times read from it, as on the web.
  const snapshot = useConfig().data?.dataSnapshot;
  const now = snapshot ? Date.parse(snapshot) : undefined;
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  if (query.isPending) return <FeedSkeleton />;
  if (query.isError)
    return <Notice title="The feed didn't load" body={query.error.message} action={{ label: "Try again", onPress: () => query.refetch() }} />;

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.post.id}
      renderItem={({ item }) => (
        <PostCard
          {...item}
          venueName={venues.get(item.market.venueId)?.name}
          record={recordLine(records.byId.get(item.post.authorId), records.minSample)}
          now={now}
          onTrade={onTrade}
        />
      )}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
      }}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => query.refetch()}
          tintColor={color.neutral600}
        />
      }
      ListEmptyComponent={
        feed === "following" ? (
          <Notice title="Nothing here yet" body="Takes from people you follow show up here. Find a few in Traders." />
        ) : (
          <Notice title="No takes yet" body="When people share their takes, they show up here." />
        )
      }
      ListFooterComponent={
        query.isFetchingNextPage ? <ActivityIndicator color={color.neutral600} style={{ margin: space[5] }} /> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
});
