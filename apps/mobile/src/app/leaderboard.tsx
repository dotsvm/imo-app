/**
 * Top traders over a period, by P&L, return or how often they're right:
 * the top three on a podium, the rest ranked below, and your own line
 * pinned at the bottom (ranked, or why not yet).
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretDownIcon } from "phosphor-react-native/src/icons/CaretDown";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Skeleton } from "~/components/skeleton";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { signedUsd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Period = "7D" | "30D" | "90D" | "All";
type Sort = "pnl" | "roi" | "right";
type Row = LeaderboardDTO["items"][number];
const SORTS: { id: Sort; label: string }[] = [
  { id: "pnl", label: "By P&L" },
  { id: "roi", label: "By return" },
  { id: "right", label: "By % right" },
];

const compact = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "+";
  if (d >= 1e6) return `${sign}$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `${sign}$${(d / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(d)}`;
};
const right = (s: Row["stats"]) =>
  s.resolved ? Math.round((s.correct / s.resolved) * 100) : 0;

export default function Leaderboard() {
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const [period, setPeriod] = useState<Period>("30D");
  const [sort, setSort] = useState<Sort>("pnl");
  const board = useInfiniteQuery({
    queryKey: ["leaderboard", "full", period, sort],
    queryFn: ({ pageParam, signal }) =>
      api<LeaderboardDTO>("/leaderboard", {
        query: { period, sort, limit: 30, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const first = board.data?.pages[0];
  const rows = board.data?.pages.flatMap((p) => p.items) ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const you = first?.you;
  const minSample = first?.minSample ?? 10;

  const head = (s: Row["stats"]) =>
    sort === "roi"
      ? `${s.returnPct >= 0 ? "+" : "−"}${Math.abs(s.returnPct).toFixed(1)}%`
      : sort === "right"
        ? `${right(s)}%`
        : compact(s.pnlCents);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Top traders</Text>
        <Pressable
          onPress={() =>
            setSort(
              SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length]!
                .id,
            )
          }
          style={styles.sort}
          accessibilityRole="button"
          accessibilityLabel={`${SORTS.find((s) => s.id === sort)!.label}. Change ranking`}
        >
          <Text style={styles.sortText}>
            {SORTS.find((s) => s.id === sort)!.label}
          </Text>
          <CaretDownIcon size={12} weight="bold" color={color.neutral800} />
        </Pressable>
      </View>
      <View style={styles.periods}>
        {(["7D", "30D", "90D", "All"] as const).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={[styles.period, period === p && styles.periodOn]}
            accessibilityRole="tab"
            accessibilityLabel={p === "All" ? "All time" : p}
            accessibilityState={{ selected: period === p }}
          >
            <Text
              style={[styles.periodText, period === p && styles.periodTextOn]}
            >
              {p === "All" ? "All time" : p}
            </Text>
          </Pressable>
        ))}
      </View>

      {board.isError ? (
        <Notice
          title="The board didn't load"
          body={board.error.message}
          action={{ label: "Try again", onPress: () => board.refetch() }}
        />
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(r) => r.trader.id}
          contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
          onEndReachedThreshold={0.5}
          onEndReached={() =>
            board.hasNextPage &&
            !board.isFetchingNextPage &&
            board.fetchNextPage()
          }
          ListHeaderComponent={
            board.isPending ? (
              <View style={styles.podium}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width={64} height={64} round />
                ))}
              </View>
            ) : podium.length ? (
              <View style={styles.podium}>
                {[podium[1], podium[0], podium[2]].map((r, i) =>
                  r ? (
                    <Pressable
                      key={r.trader.id}
                      onPress={() =>
                        openTrader(r.trader.handle, r.trader.isYou)
                      }
                      style={[styles.place, i === 1 && styles.placeFirst]}
                      accessibilityRole="link"
                      accessibilityLabel={`${r.rank}. ${r.trader.name}, ${head(r.stats)}`}
                    >
                      <View>
                        <View
                          style={[styles.ring, i === 1 && styles.ringFirst]}
                        >
                          <Avatar
                            url={r.trader.avatarUrl}
                            size={i === 1 ? 72 : 56}
                          />
                        </View>
                        <View
                          style={[styles.medal, i === 1 && styles.medalFirst]}
                        >
                          <Text style={styles.medalText}>{r.rank}</Text>
                        </View>
                      </View>
                      <Text style={styles.placeName} numberOfLines={1}>
                        {r.trader.name.split(" ")[0]}
                      </Text>
                      <Text
                        style={[
                          styles.placeValue,
                          {
                            color:
                              r.stats.pnlCents < 0 && sort === "pnl"
                                ? color.neg
                                : color.pos,
                          },
                        ]}
                      >
                        {head(r.stats)}
                      </Text>
                    </Pressable>
                  ) : (
                    <View key={i} style={styles.place} />
                  ),
                )}
              </View>
            ) : (
              <Notice
                title="No one ranked yet"
                body={`Traders show up once ${minSample} of their calls resolve.`}
              />
            )
          }
          renderItem={({ item: r }) => (
            <Pressable
              onPress={() => openTrader(r.trader.handle, r.trader.isYou)}
              style={styles.row}
              accessibilityRole="link"
            >
              <Text style={styles.rank}>{r.rank}</Text>
              <Avatar url={r.trader.avatarUrl} size={36} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.trader.name}
                </Text>
                <Text style={styles.small}>
                  {right(r.stats)}% right ·{" "}
                  {r.stats.resolved < minSample
                    ? "low sample"
                    : `${r.stats.resolved.toLocaleString("en-US")} resolved`}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Text
                  style={[
                    styles.pnl,
                    { color: r.stats.pnlCents < 0 ? color.neg : color.pos },
                  ]}
                >
                  {signedUsd(r.stats.pnlCents)}
                </Text>
                <Text style={styles.small}>
                  {r.stats.returnPct >= 0 ? "+" : "−"}
                  {Math.abs(r.stats.returnPct).toFixed(1)}%
                </Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            board.isFetchingNextPage ? (
              <ActivityIndicator
                color={color.neutral600}
                style={{ margin: space[5] }}
              />
            ) : null
          }
        />
      )}

      {you?.stats && me ? (
        <View
          style={[styles.you, { bottom: Math.max(insets.bottom, space[3]) }]}
        >
          <View style={styles.youRank}>
            <Text style={styles.youRankText}>
              {you.rank ? `#${you.rank}` : "—"}
            </Text>
          </View>
          <Avatar url={me.user.avatarUrl} size={36} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.name}>You</Text>
            <Text style={styles.small}>
              {you.stats.correct} of {you.stats.resolved} right
              {!you.qualifies ? " · not ranked yet" : ""}
            </Text>
          </View>
          <Text
            style={[
              styles.pnl,
              { color: you.stats.pnlCents < 0 ? color.neg : color.pos },
            ]}
          >
            {signedUsd(you.stats.pnlCents)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
  },
  back: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 26,
    letterSpacing: -0.7,
    color: color.text,
  },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  sortText: { fontFamily: font.medium, fontSize: 12, color: color.neutral800 },
  periods: {
    flexDirection: "row",
    gap: space[1],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  period: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    justifyContent: "center",
  },
  periodOn: { backgroundColor: "#eceadf" },
  periodText: {
    fontFamily: font.medium,
    fontSize: text.ui,
    color: color.neutral700,
  },
  periodTextOn: { color: "#0b0d0c" },
  podium: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  place: { flex: 1, alignItems: "center", gap: 6 },
  placeFirst: { marginBottom: space[4] },
  ring: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: color.neutral500,
  },
  ringFirst: { borderColor: color.gold, borderWidth: 2 },
  medal: {
    position: "absolute",
    bottom: -6,
    alignSelf: "center",
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.neutral400,
    borderWidth: 2,
    borderColor: color.bg,
  },
  medalFirst: { backgroundColor: color.gold },
  medalText: { fontFamily: font.semibold, fontSize: 11, color: "#0b0d0c" },
  placeName: {
    fontFamily: font.medium,
    fontSize: text.body,
    color: color.text,
    marginTop: space[2],
  },
  placeValue: {
    fontFamily: font.medium,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 10,
  },
  rank: {
    width: 22,
    fontFamily: font.medium,
    fontSize: text.ui,
    color: color.neutral600,
    fontVariant: ["tabular-nums"],
  },
  name: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text },
  small: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  pnl: {
    fontFamily: font.medium,
    fontSize: text.body + 1,
    fontVariant: ["tabular-nums"],
  },
  you: {
    position: "absolute",
    left: space[3],
    right: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: radius.panel,
    backgroundColor: "#15211a",
    borderWidth: 1,
    borderColor: "#2f4733",
    boxShadow: "0 10px 30px -10px rgba(0,0,0,0.7)",
  },
  youRank: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.chip,
    backgroundColor: "#1f3324",
  },
  youRankText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.pos,
    fontVariant: ["tabular-nums"],
  },
});
