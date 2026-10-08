/**
 * Home: your balance and Deposit, the rooms that are live right now, then
 * five views — two feeds of calls, the traders board, trending markets and
 * rooms. Everything above the list scrolls with it.
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Fab } from "~/components/fab";
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { TopBar } from "~/components/top-bar";
import { UnderlineTabs } from "~/components/underline-tabs";
import { useConfig } from "~/features/auth/auth";
import { FeedSkeleton } from "~/features/feed/feed-skeleton";
import { PostCard } from "~/features/feed/post-card";
import { type FeedEntry, useFeed } from "~/features/feed/use-feed";
import { BalanceHeader } from "~/features/home/balance-header";
import { LiveRooms } from "~/features/home/live-rooms";
import { Notice } from "~/features/home/notice";
import { RoomsList } from "~/features/home/rooms-list";
import { TradersList } from "~/features/home/traders-list";
import { TrendingList } from "~/features/home/trending-list";
import { TradeSheet } from "~/features/trade/trade-sheet";
import type { Outcome } from "~/lib/market";
import { color, space } from "~/theme/tokens";

type View_ = "for-you" | "following" | "traders" | "trending" | "rooms";
const VIEWS = [
  { id: "for-you", label: "For you" },
  { id: "following", label: "Following" },
  { id: "traders", label: "Traders" },
  { id: "trending", label: "Trending" },
  { id: "rooms", label: "Rooms" },
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

  const header = (
    <>
      <BalanceHeader />
      <LiveRooms />
      <UnderlineTabs options={VIEWS} value={view} onChange={setView} />
    </>
  );

  return (
    <View style={styles.screen}>
      <TopBar onSearch={() => router.push("/search")} />
      {view === "traders" ? (
        <TradersList header={header} bottomInset={bottom + space[5]} />
      ) : view === "trending" ? (
        <TrendingList header={header} bottomInset={bottom + space[5]} />
      ) : view === "rooms" ? (
        <RoomsList header={header} bottomInset={bottom + space[5]} />
      ) : (
        <Feed key={view} feed={view} header={header} onTrade={onTrade} bottomInset={bottom + 88} />
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
  header,
  onTrade,
  bottomInset,
}: {
  feed: "for-you" | "following";
  header: ReactElement;
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
  bottomInset: number;
}) {
  const query = useFeed(feed);
  // The demo dataset describes one fixed moment; times read from it, as on the web.
  const snapshot = useConfig().data?.dataSnapshot;
  const now = snapshot ? Date.parse(snapshot) : undefined;
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  if (query.isPending || query.isError)
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        {header}
        {query.isPending ? (
          <FeedSkeleton />
        ) : (
          <Notice title="The feed didn't load" body={query.error.message} action={{ label: "Try again", onPress: () => query.refetch() }} />
        )}
      </ScrollView>
    );

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.post.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => <PostCard {...item} now={now} onTrade={onTrade} />}
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
          <Notice title="Nothing here yet" body="Calls from people you follow show up here. Find a few in Traders." />
        ) : (
          <Notice title="No calls yet" body="When people share their calls, they show up here." />
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
