/**
 * Onboarding, step 2: follow a few of the sharpest callers, ranked by how
 * often they've been right (only those with enough resolved calls to count).
 * On a paper server, the demo cash waiting for them sits above the button.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { CoinsIcon } from "phosphor-react-native/src/icons/Coins";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { useConfig } from "~/features/auth/auth";
import { finishOnboarding, setFollowing } from "~/features/auth/onboarding";
import { Lede, Problem, Progress, Screen, Title } from "~/features/auth/parts";
import { api } from "~/lib/api";
import { count, wholeDollars } from "~/lib/format";
import { color, font } from "~/theme/tokens";

const SHOWN = 6;

export default function Follow() {
  const queryClient = useQueryClient();
  const config = useConfig().data;
  const callers = useQuery({
    queryKey: ["onboarding", "callers"],
    queryFn: ({ signal }) =>
      api<LeaderboardDTO>("/leaderboard", { query: { period: "All", sort: "right", sample: "on", limit: SHOWN + 2 }, signal }),
  });
  const [following, setFollowingState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = (callers.data?.items ?? []).filter((r) => !r.trader.isYou).slice(0, SHOWN);

  async function toggle(handle: string, now: boolean) {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setFollowingState((s) => ({ ...s, [handle]: !now }));
    try {
      await setFollowing(handle, !now);
    } catch (error) {
      setFollowingState((s) => ({ ...s, [handle]: now }));
      setProblem(error instanceof Error ? error.message : "Couldn't update that. Try again.");
    }
  }

  async function finish() {
    setBusy(true);
    setProblem(null);
    try {
      await finishOnboarding(queryClient);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't finish. Try again.");
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          {/* Paper only: a real-money server has no demo cash to offer. */}
          {config && config.trading !== "wallet" ? (
            <View style={styles.cash}>
              <CoinsIcon size={20} weight="fill" color={color.pos} />
              <Text style={styles.cashText}>
                <Text style={styles.cashStrong}>{wholeDollars(config.paper.startingBalanceCents)} demo cash</Text> is waiting. Real
                markets, no real money.
              </Text>
            </View>
          ) : null}
          <Button size="lg" label="Start trading" onPress={finish} loading={busy} />
        </>
      }
    >
      <Progress step={2} of={2} onSkip={finish} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title after="progress">Follow a few sharp callers</Title>
        <Lede size="sm">Their calls show up first in your feed.</Lede>

        <View style={styles.list}>
          {callers.isPending
            ? Array.from({ length: 5 }, (_, i) => (
                <View key={i} style={styles.row} accessibilityLabel={i ? undefined : "Loading callers"} accessibilityRole={i ? undefined : "progressbar"}>
                  <Skeleton width={44} height={44} round />
                  <View style={styles.who}>
                    <Skeleton width={110} height={13} />
                    <Skeleton width={150} height={10} />
                  </View>
                  <Skeleton width={92} height={34} round />
                </View>
              ))
            : rows.map(({ trader, stats }) => {
                const on = following[trader.handle] ?? trader.viewer?.following ?? false;
                const right = stats.resolved ? Math.round((stats.correct / stats.resolved) * 100) : null;
                return (
                  <View key={trader.id} style={styles.row}>
                    <Avatar url={trader.avatarUrl} size={44} />
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {trader.name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[right !== null ? `${right}% right` : `@${trader.handle}`, trader.focus || `${count(stats.resolved)} resolved`].join(" · ")}
                      </Text>
                    </View>
                    <Button
                      size="sm"
                      variant={on ? "quiet" : "primary"}
                      label={on ? "Following" : "Follow"}
                      onPress={() => toggle(trader.handle, on)}
                      style={[styles.follow, on && styles.followOn]}
                      accessibilityLabel={`${on ? "Unfollow" : "Follow"} ${trader.name}`}
                    />
                  </View>
                );
              })}
          {callers.isError ? <Problem message="Couldn't load callers. You can find people later in Discover." /> : null}
          {callers.isSuccess && rows.length === 0 ? (
            <Text style={styles.empty}>No callers with enough resolved calls yet. You can find people later in Discover.</Text>
          ) : null}
        </View>
        <Problem message={problem} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 24 },
  // Rows bleed to 12 from the screen's edge; their own padding brings content back to 24.
  list: { marginTop: 16, marginHorizontal: -12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  who: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontFamily: font.medium, fontSize: 15, color: color.text },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.muted },
  empty: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.muted, paddingHorizontal: 12 },
  follow: { paddingHorizontal: 16 },
  followOn: { borderColor: "rgba(255, 255, 255, 0.18)" },
  cash: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 6,
    borderRadius: 18,
    backgroundColor: "rgba(181, 230, 161, 0.08)",
  },
  cashText: { flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.neutral800 },
  cashStrong: { fontFamily: font.medium, color: color.text },
});
