/**
 * Onboarding, step 1: what they have a hunch about. Picks shape the feed.
 * Only the API's categories that have markets on this server right now are
 * offered; nothing that would lead to an empty feed.
 */
import { useQueries, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ComponentType, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { IconProps } from "phosphor-react-native";
import { BankIcon } from "phosphor-react-native/src/icons/Bank";
import { ChartLineUpIcon } from "phosphor-react-native/src/icons/ChartLineUp";
import { CloudSunIcon } from "phosphor-react-native/src/icons/CloudSun";
import { CpuIcon } from "phosphor-react-native/src/icons/Cpu";
import { CurrencyBtcIcon } from "phosphor-react-native/src/icons/CurrencyBtc";
import { FilmStripIcon } from "phosphor-react-native/src/icons/FilmStrip";
import { FlaskIcon } from "phosphor-react-native/src/icons/Flask";
import { SoccerBallIcon } from "phosphor-react-native/src/icons/SoccerBall";
import type { MarketPage } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { INTERESTS, type Interest, saveInterests } from "~/features/auth/onboarding";
import { Lede, Problem, Progress, Screen, Title } from "~/features/auth/parts";
import { useMe } from "~/features/auth/use-account";
import { api } from "~/lib/api";
import { color, font, radius } from "~/theme/tokens";

const ICONS: Record<Interest, ComponentType<IconProps>> = {
  Politics: BankIcon,
  Economics: ChartLineUpIcon,
  Sports: SoccerBallIcon,
  Crypto: CurrencyBtcIcon,
  Tech: CpuIcon,
  Culture: FilmStripIcon,
  Climate: CloudSunIcon,
  Science: FlaskIcon,
};

export default function Interests() {
  const queryClient = useQueryClient();
  const me = useMe().data;
  const [picked, setPicked] = useState<Set<Interest>>(() => new Set(me?.settings.interests ?? []));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // One open market is enough to say a category has something to show.
  const counts = useQueries({
    queries: INTERESTS.map(({ id }) => ({
      queryKey: ["markets", "category-has", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api<MarketPage>("/markets", { query: { category: id, status: "open", limit: 1 }, signal }),
      staleTime: 10 * 60 * 1000,
    })),
  });
  const loading = counts.some((q) => q.isPending);
  // A category whose check failed stays (we can't say it's empty); one you'd already picked stays too.
  const topics = INTERESTS.filter(({ id }, i) => {
    const q = counts[i]!;
    return picked.has(id) || q.isError || (q.data?.items.length ?? 0) > 0;
  });

  const toggle = (id: Interest) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function next() {
    setBusy(true);
    setProblem(null);
    try {
      // Saved in the chips' order, which is the order people see.
      await saveInterests(INTERESTS.map((i) => i.id).filter((id) => picked.has(id)));
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      router.push("/follow");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <Button
          size="lg"
          label={picked.size ? `Continue · ${picked.size} picked` : "Pick at least one"}
          onPress={next}
          disabled={!picked.size}
          loading={busy}
        />
      }
    >
      <Progress step={1} of={2} onSkip={() => router.push("/follow")} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title after="progress">What do you have a hunch about?</Title>
        <Lede size="sm">{"Pick a few. We'll fill your feed with these markets."}</Lede>
        <View style={styles.chips}>
          {loading
            ? [104, 120, 96, 92, 86, 100].map((w, i) => <Skeleton key={i} width={w} height={42} round />)
            : topics.map(({ id, label }) => {
                const on = picked.has(id);
                const Icon = ICONS[id];
                return (
                  <Pressable
                    key={id}
                    onPress={() => toggle(id)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
                  >
                    <Icon size={16} weight="fill" color={on ? color.pos : color.neutral800} />
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
                  </Pressable>
                );
              })}
        </View>
        {!loading && !topics.length ? (
          <Text style={styles.none}>No markets to pick from yet. Skip for now; your feed shows everything.</Text>
        ) : null}
        <Problem message={problem} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 24 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipOn: { backgroundColor: color.pos200, borderColor: "rgba(181, 230, 161, 0.45)" },
  chipPressed: { opacity: 0.85 },
  chipLabel: { fontFamily: font.medium, fontSize: 14, color: color.neutral800 },
  chipLabelOn: { color: color.pos },
  none: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.muted, marginTop: 16 },
});
