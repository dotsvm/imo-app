/**
 * Home: your balance and Deposit, the rooms that are live right now, then
 * five views — two feeds of calls, the traders board, trending markets and
 * rooms. Everything above the list scrolls with it; the list fades out
 * under the + and the tab bar.
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { ArrowClockwiseIcon } from "phosphor-react-native/src/icons/ArrowClockwise";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { WifiSlashIcon } from "phosphor-react-native/src/icons/WifiSlash";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Fab } from "~/components/fab";
import { tabBarSpace } from "~/components/tab-bar";
import { TopBar } from "~/components/top-bar";
import { UnderlineTabs } from "~/components/underline-tabs";
import { useConfig } from "~/features/auth/auth";
import { FeedBanner } from "~/features/feed/feed-banner";
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
  // The screen's bottom that the floating tab bar covers.
  const bottom = tabBarSpace(insets.bottom);

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
        <Feed
          key={view}
          feed={view}
          header={header}
          onTrade={onTrade}
          onFindTraders={() => setView("traders")}
          bottomInset={bottom + 88}
        />
      )}
      <View style={styles.fade} />
      <Fab bottom={bottom + 20} onPress={() => router.push("/compose")} />
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
  onFindTraders,
  bottomInset,
}: {
  feed: "for-you" | "following";
  header: ReactElement;
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
  onFindTraders: () => void;
  bottomInset: number;
}) {
  const query = useFeed(feed);
  // The demo dataset describes one fixed moment; times read from it, as on the web.
  const snapshot = useConfig().data?.dataSnapshot;
  const now = snapshot ? Date.parse(snapshot) : undefined;
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  const retry = { label: "Retry", onPress: () => query.refetch(), icon: <ArrowClockwiseIcon size={14} weight="fill" color={color.text} /> };

  if (query.isPending || (query.isError && !query.data))
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }}>
        {header}
        {query.isPending ? (
          <FeedSkeleton />
        ) : (
          <Notice
            icon={<WifiSlashIcon size={24} weight="fill" color={color.neutral700} />}
            title="Couldn’t refresh the feed"
            body={query.error?.message ?? "Check your connection and try again."}
            action={retry}
          />
        )}
      </ScrollView>
    );

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.post.id}
      ListHeaderComponent={
        query.isError ? (
          <>
            {header}
            {/* A failed refresh keeps the posts we have, and says how old they are. */}
            <FeedBanner updatedAt={query.dataUpdatedAt} onRetry={() => query.refetch()} />
          </>
        ) : (
          header
        )
      }
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
          <Notice
            icon={<UsersThreeIcon size={24} weight="fill" color={color.neutral700} />}
            title="Your Following feed is empty"
            body="Follow a few traders whose reasoning you trust. Their predictions — wins and losses — show up here."
            action={{ label: "Find traders", onPress: onFindTraders }}
            secondary={{ label: "Browse rooms", onPress: () => router.navigate("/rooms") }}
          />
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
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 150,
    pointerEvents: "none",
    experimental_backgroundImage: "linear-gradient(180deg, rgba(9, 13, 11, 0), #090d0b 60%)",
  },
});
