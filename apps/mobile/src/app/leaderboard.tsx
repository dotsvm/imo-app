/**
 * Top traders over a period, by P&L, return or how often they're right:
 * the top three on a podium under a faint gold light, the rest ranked
 * below, and your own line pinned at the bottom (ranked, or why not yet).
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretDownIcon } from "phosphor-react-native/src/icons/CaretDown";
import { TrophyIcon } from "phosphor-react-native/src/icons/Trophy";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { ActionSheet } from "~/components/action-sheet";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { ChipTabs } from "~/components/chip-tabs";
import { ScreenHeader } from "~/components/screen-header";
import { Skeleton } from "~/components/skeleton";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { signedUsd } from "~/lib/format";
import { openTrader } from "~/lib/nav";
import { color, font, radius } from "~/theme/tokens";

type Period = "7D" | "30D" | "90D" | "All";
type Sort = "pnl" | "roi" | "right";
type Row = LeaderboardDTO["items"][number];
const SORTS: { id: Sort; label: string }[] = [
  { id: "pnl", label: "By P&L" },
  { id: "roi", label: "By return" },
  { id: "right", label: "By % right" },
];
const PERIODS = [
  { id: "7D", label: "7D" },
  { id: "30D", label: "30D" },
  { id: "90D", label: "90D" },
  { id: "All", label: "All time" },
] as const;

const compact = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "+";
  if (d >= 1e6) return `${sign}$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `${sign}$${(d / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(d)}`;
};
const pct = (s: Row["stats"]) => (s.resolved ? Math.round((s.correct / s.resolved) * 100) : 0);
const ret = (s: Row["stats"]) => `${s.returnPct >= 0 ? "+" : "−"}${Math.abs(s.returnPct).toFixed(1)}%`;

export default function Leaderboard() {
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const [period, setPeriod] = useState<Period>("30D");
  const [sort, setSort] = useState<Sort>("pnl");
  const [sorting, setSorting] = useState(false);
  const board = useInfiniteQuery({
    queryKey: ["leaderboard", "full", period, sort],
    queryFn: ({ pageParam, signal }) =>
      api<LeaderboardDTO>("/leaderboard", { query: { period, sort, limit: 30, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const first = board.data?.pages[0];
  const rows = board.data?.pages.flatMap((p) => p.items) ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const you = first?.you;
  const minSample = first?.minSample ?? 10;
  const sortLabel = SORTS.find((s) => s.id === sort)!.label;

  const head = (s: Row["stats"]) => (sort === "roi" ? ret(s) : sort === "right" ? `${pct(s)}%` : compact(s.pnlCents));
  const headTone = (s: Row["stats"]) => ((sort === "pnl" ? s.pnlCents : sort === "roi" ? s.returnPct : 0) < 0 ? color.neg : color.gain);

  return (
    <View style={styles.screen}>
      <View style={styles.glow} />
      <ScreenHeader
        title="Top traders"
        size={26}
        style={styles.header}
        right={
          <Pressable
            onPress={() => setSorting(true)}
            style={({ pressed }) => [styles.sort, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={`${sortLabel}. Change ranking`}
          >
            <Text style={styles.sortText}>{sortLabel}</Text>
            <CaretDownIcon size={11} weight="bold" color={color.text} />
          </Pressable>
        }
      />
      <ChipTabs options={PERIODS} value={period} onChange={setPeriod} style={styles.periods} />

      {board.isError ? (
        <Notice title="The board didn't load" body={board.error.message} action={{ label: "Try again", onPress: () => board.refetch() }} />
      ) : (
        <FlatList
          data={board.isPending ? [] : rest}
          keyExtractor={(r) => r.trader.id}
          contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
          onEndReachedThreshold={0.5}
          onEndReached={() => board.hasNextPage && !board.isFetchingNextPage && board.fetchNextPage()}
          ListHeaderComponent={
            board.isPending ? (
              <BoardSkeleton />
            ) : podium.length ? (
              <View style={styles.podium}>
                {[podium[1], podium[0], podium[2]].map((r, i) => {
                  const top = i === 1;
                  return r ? (
                    <Pressable
                      key={r.trader.id}
                      onPress={() => openTrader(r.trader.handle, r.trader.isYou)}
                      style={[styles.place, top ? styles.placeFirst : styles.placeSide]}
                      accessibilityRole="link"
                      accessibilityLabel={`${r.rank}. ${r.trader.name}, ${head(r.stats)}`}
                    >
                      <View>
                        <View style={[styles.ring, top && styles.ringFirst]}>
                          <Avatar url={r.trader.avatarUrl} size={top ? 72 : 56} />
                        </View>
                        <View style={[styles.medal, top && styles.medalFirst]}>
                          <Text style={[styles.medalText, top && styles.medalTextFirst]}>{r.rank}</Text>
                        </View>
                      </View>
                      <Text style={styles.placeName} numberOfLines={1}>
                        {r.trader.name.split(" ")[0]}
                      </Text>
                      <Text style={[styles.placeValue, { color: headTone(r.stats) }]}>{head(r.stats)}</Text>
                    </Pressable>
                  ) : (
                    <View key={i} style={[styles.place, top ? styles.placeFirst : styles.placeSide]} />
                  );
                })}
              </View>
            ) : (
              <View style={styles.empty}>
                <TrophyIcon size={22} weight="fill" color={color.gold} />
                <Text style={styles.emptyTitle}>
                  No traders with {minSample}+ resolved in {period === "All" ? "all time" : period}
                </Text>
                <Text style={styles.emptyBody}>Widen the period.</Text>
                {period !== "30D" ? <Button variant="surface" size="sm" label="Show 30D" onPress={() => setPeriod("30D")} style={{ marginTop: 6 }} /> : null}
              </View>
            )
          }
          renderItem={({ item: r }) => (
            <Pressable
              onPress={() => openTrader(r.trader.handle, r.trader.isYou)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="link"
              accessibilityLabel={`${r.rank}. ${r.trader.name}, ${signedUsd(r.stats.pnlCents)}, ${pct(r.stats)}% right`}
            >
              <Text style={styles.rank}>{r.rank}</Text>
              <Avatar url={r.trader.avatarUrl} size={40} />
              <View style={styles.rowMain}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.trader.name}
                </Text>
                <Text style={styles.small} numberOfLines={1}>
                  {pct(r.stats)}% right · {r.lowSample ? "Low sample" : `${r.stats.resolved.toLocaleString("en-US")} resolved`}
                </Text>
              </View>
              <View style={styles.rowAside}>
                <Text style={[styles.pnl, { color: r.stats.pnlCents < 0 ? color.neg : color.gain }]}>{signedUsd(r.stats.pnlCents)}</Text>
                <Text style={styles.small}>{ret(r.stats)}</Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={board.isFetchingNextPage ? <ActivityIndicator color={color.neutral600} style={{ margin: 24 }} /> : null}
        />
      )}

      {you?.stats && me ? (
        <View style={[styles.you, { bottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.youRank}>
            <Text style={styles.youRankText}>{you.rank ? `#${you.rank}` : "—"}</Text>
          </View>
          <Avatar url={me.user.avatarUrl} size={40} />
          <View style={styles.rowMain}>
            <Text style={styles.name}>You</Text>
            <Text style={styles.small} numberOfLines={1}>
              {you.stats.correct} of {you.stats.resolved} right
              {!you.qualifies ? " · low sample" : you.rank === null ? " · hidden from the board" : ""}
            </Text>
          </View>
          <Text style={[styles.pnl, { color: you.stats.pnlCents < 0 ? color.neg : color.gain }]}>{signedUsd(you.stats.pnlCents)}</Text>
        </View>
      ) : null}

      <ActionSheet
        open={sorting}
        onClose={() => setSorting(false)}
        title="Rank traders"
        actions={SORTS.map((s) => ({
          label: s.id === sort ? `${s.label} ✓` : s.label,
          onPress: () => {
            if (Platform.OS !== "web") Haptics.selectionAsync();
            setSort(s.id);
          },
        }))}
      />
    </View>
  );
}

function BoardSkeleton() {
  return (
    <View accessibilityLabel="Loading the board" accessibilityRole="progressbar">
      <View style={styles.podium}>
        <View style={[styles.place, styles.placeSide]}>
          <Skeleton width={56} height={56} round />
        </View>
        <View style={[styles.place, styles.placeFirst]}>
          <Skeleton width={72} height={72} round />
        </View>
        <View style={[styles.place, styles.placeSide]}>
          <Skeleton width={56} height={56} round />
        </View>
      </View>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={14} height={12} />
          <Skeleton width={40} height={40} round />
          <View style={styles.rowMain}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="40%" height={10} />
          </View>
          <View style={styles.rowAside}>
            <Skeleton width={70} height={13} />
            <Skeleton width={40} height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  glow: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
    experimental_backgroundImage: "radial-gradient(70% 30% at 50% 18%, rgba(226, 200, 146, 0.08) 0%, rgba(226, 200, 146, 0) 100%)",
  },
  header: { backgroundColor: "transparent" },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  sortText: { fontFamily: font.regular, fontSize: 12, color: color.text },
  periods: { paddingBottom: 8 },
  podium: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  place: { alignItems: "center" },
  placeSide: { flex: 1, marginTop: 22 },
  placeFirst: { flex: 1.15 },
  ring: { borderRadius: radius.pill, borderWidth: 2, borderColor: "rgba(255, 255, 255, 0.18)" },
  ringFirst: { borderWidth: 3, borderColor: color.gold },
  medal: {
    position: "absolute",
    bottom: -8,
    alignSelf: "center",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#26322b",
    borderWidth: 3,
    borderColor: color.bg,
  },
  medalFirst: { backgroundColor: color.gold },
  medalText: { fontFamily: font.semibold, fontSize: 11, color: color.text, fontVariant: ["tabular-nums"] },
  medalTextFirst: { color: "#1a1408" },
  placeName: { fontFamily: font.medium, fontSize: 13, color: color.text, marginTop: 14 },
  placeValue: { fontFamily: font.regular, fontSize: 12, marginTop: 4, fontVariant: ["tabular-nums"] },
  empty: {
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 18,
    backgroundColor: color.card,
  },
  emptyTitle: { fontFamily: font.medium, fontSize: 15, color: color.text, textAlign: "center", marginTop: 4 },
  emptyBody: { fontFamily: font.regular, fontSize: 13, color: color.muted, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  rowPressed: { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  rowMain: { flex: 1, gap: 3, minWidth: 0 },
  rowAside: { alignItems: "flex-end", gap: 3 },
  rank: { width: 22, fontFamily: font.regular, fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  name: { fontFamily: font.medium, fontSize: 14, color: color.text },
  small: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  pnl: { fontFamily: font.medium, fontSize: 14, fontVariant: ["tabular-nums"] },
  you: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: 18,
    // Solid under the tint, so rows scrolling beneath don't show through.
    backgroundColor: "#0f1912",
    borderWidth: 1,
    borderColor: "rgba(111, 211, 143, 0.2)",
    boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.7)",
  },
  youRank: {
    minWidth: 34,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(111, 211, 143, 0.14)",
  },
  youRankText: { fontFamily: font.semibold, fontSize: 11, color: color.gain, fontVariant: ["tabular-nums"] },
});
