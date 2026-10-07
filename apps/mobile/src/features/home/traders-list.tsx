/** Home → Traders: the 30-day leaderboard by P&L, with each trader's record. */
import { router } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "~/components/avatar";
import { Skeleton } from "~/components/skeleton";
import { recordLine, useLeaderboard } from "~/features/feed/use-records";
import { arrowUsd } from "~/lib/format";
import { openTrader } from "~/lib/nav";
import { color, font, space, text } from "~/theme/tokens";
import { Notice } from "./notice";

export function TradersList({ bottomInset }: { bottomInset: number }) {
  const board = useLeaderboard("30D", "pnl", 50);
  if (board.isPending) return <RowsSkeleton />;
  if (board.isError)
    return (
      <Notice
        title="Traders didn't load"
        body={board.error.message}
        action={{ label: "Try again", onPress: () => board.refetch() }}
      />
    );
  const minSample = board.data.minSample;
  return (
    <FlatList
      data={board.data.items}
      keyExtractor={(r) => r.trader.id}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      refreshControl={
        <RefreshControl
          refreshing={board.isRefetching}
          onRefresh={() => board.refetch()}
          tintColor={color.neutral600}
        />
      }
      ListHeaderComponent={
        <Pressable
          onPress={() => router.push("/leaderboard")}
          style={styles.full}
          accessibilityRole="link"
        >
          <Text style={styles.fullText}>30-day P&L · by all traders</Text>
          <Text style={styles.fullLink}>Full board ›</Text>
        </Pressable>
      }
      ListEmptyComponent={
        <Notice
          title="No ranked traders yet"
          body="Traders show up here once their calls start resolving."
        />
      }
      renderItem={({ item: { rank, trader, stats } }) => (
        <Pressable
          onPress={() => openTrader(trader.handle, trader.isYou)}
          style={styles.row}
          accessibilityRole="link"
        >
          <Text style={styles.rank}>{rank}</Text>
          <Avatar url={trader.avatarUrl} size={40} />
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>
              {trader.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {recordLine(stats, minSample) ?? `@${trader.handle}`}
            </Text>
          </View>
          <Text
            style={[
              styles.pnl,
              {
                color:
                  stats.pnlCents < 0
                    ? color.neg
                    : stats.pnlCents > 0
                      ? color.pos
                      : color.neutral700,
              },
            ]}
          >
            {arrowUsd(stats.pnlCents)}
          </Text>
        </Pressable>
      )}
    />
  );
}

function RowsSkeleton() {
  return (
    <View accessibilityLabel="Loading traders" accessibilityRole="progressbar">
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={14} height={12} />
          <Skeleton width={40} height={40} round />
          <View style={styles.who}>
            <Skeleton width={120} height={13} />
            <Skeleton width={150} height={11} />
          </View>
          <Skeleton width={84} height={14} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  fullText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  fullLink: { fontFamily: font.medium, fontSize: 12, color: color.pos },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  rank: {
    width: 20,
    fontFamily: font.medium,
    fontSize: text.ui,
    color: color.neutral600,
    fontVariant: ["tabular-nums"],
  },
  who: { flex: 1, gap: 4 },
  name: { fontFamily: font.medium, fontSize: 16, color: color.text },
  meta: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neutral700,
  },
  pnl: {
    fontFamily: font.medium,
    fontSize: text.post,
    fontVariant: ["tabular-nums"],
  },
});
