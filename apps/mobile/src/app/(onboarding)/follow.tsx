/**
 * Onboarding, step 2: follow a few of the sharpest callers, ranked by how
 * often they've been right (only those with enough resolved calls to count).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
import { color, font, radius, space, text } from "~/theme/tokens";

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
          {config ? (
            <View style={styles.cash}>
              <CoinsIcon size={22} weight="fill" color={color.pos} />
              <Text style={styles.cashText}>
                <Text style={styles.cashStrong}>{wholeDollars(config.paper.startingBalanceCents)} demo cash</Text> is waiting.
                Real markets, no real money.
              </Text>
            </View>
          ) : null}
          <Button size="lg" label="Start trading" onPress={finish} loading={busy} />
        </>
      }
    >
      <Progress step={2} of={2} onSkip={finish} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title>Follow a few sharp callers</Title>
        <Lede>Their calls show up first in your feed.</Lede>

        <View style={styles.list}>
          {callers.isPending
            ? Array.from({ length: 5 }, (_, i) => (
                <View key={i} style={styles.row}>
                  <Skeleton width={48} height={48} round />
                  <View style={styles.who}>
                    <Skeleton width={110} height={13} />
                    <Skeleton width={150} height={11} />
                  </View>
                  <Skeleton width={84} height={34} round />
                </View>
              ))
            : rows.map(({ trader, stats }) => {
                const on = following[trader.handle] ?? trader.viewer?.following ?? false;
                const right = stats.resolved ? Math.round((stats.correct / stats.resolved) * 100) : null;
                return (
                  <View key={trader.id} style={styles.row}>
                    <Avatar url={trader.avatarUrl} size={48} />
                    <View style={styles.who}>
                      <Text style={styles.name} numberOfLines={1}>
                        {trader.name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[right !== null ? `${right}% right` : `@${trader.handle}`, trader.focus || `${count(stats.resolved)} calls`].join(" · ")}
                      </Text>
                    </View>
                    <Button
                      variant={on ? "quiet" : "primary"}
                      label={on ? "Following" : "Follow"}
                      onPress={() => toggle(trader.handle, on)}
                      accessibilityLabel={`${on ? "Unfollow" : "Follow"} ${trader.name}`}
                    />
                  </View>
                );
              })}
          {callers.isError ? <Problem message="Couldn't load callers. You can find people later in Discover." /> : null}
          {callers.isSuccess && rows.length === 0 ? (
            <Text style={styles.meta}>No callers with enough resolved calls yet. You can find people later in Discover.</Text>
          ) : null}
        </View>
        <Problem message={problem} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space[5] },
  list: { marginTop: space[6], gap: space[5] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  who: { flex: 1, gap: 4 },
  name: { fontFamily: font.medium, fontSize: 17, color: color.text },
  meta: { fontFamily: font.regular, fontSize: text.post, color: color.neutral700 },
  cash: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radius.sheet + 2,
    backgroundColor: "#141a17",
  },
  cashText: { flex: 1, fontFamily: font.regular, fontSize: text.post, lineHeight: 21, color: color.neutral800 },
  cashStrong: { fontFamily: font.semibold, color: color.text },
});
