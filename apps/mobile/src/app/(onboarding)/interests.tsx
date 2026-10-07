/** Onboarding, step 1: what they have a hunch about. Picks shape the feed. */
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { type ComponentType, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { IconProps } from "phosphor-react-native";
import { BankIcon } from "phosphor-react-native/src/icons/Bank";
import { ChartLineUpIcon } from "phosphor-react-native/src/icons/ChartLineUp";
import { CloudSunIcon } from "phosphor-react-native/src/icons/CloudSun";
import { CpuIcon } from "phosphor-react-native/src/icons/Cpu";
import { CurrencyBtcIcon } from "phosphor-react-native/src/icons/CurrencyBtc";
import { FilmStripIcon } from "phosphor-react-native/src/icons/FilmStrip";
import { FlaskIcon } from "phosphor-react-native/src/icons/Flask";
import { SoccerBallIcon } from "phosphor-react-native/src/icons/SoccerBall";
import { Button } from "~/components/button";
import { INTERESTS, type Interest, saveInterests } from "~/features/auth/onboarding";
import { Lede, Problem, Progress, Screen, Title } from "~/features/auth/parts";
import { useMe } from "~/features/auth/use-account";
import { color, font, radius, space } from "~/theme/tokens";

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

  const toggle = (id: Interest) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          label={picked.size ? `Continue · ${picked.size} picked` : "Continue"}
          onPress={next}
          loading={busy}
        />
      }
    >
      <Progress step={1} of={2} onSkip={() => router.push("/follow")} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title>What do you have a hunch about?</Title>
        <Lede>{"Pick a few. We'll fill your feed with these markets."}</Lede>
        <View style={styles.chips}>
          {INTERESTS.map(({ id, label }) => {
            const on = picked.has(id);
            const Icon = ICONS[id];
            return (
              <Pressable
                key={id}
                onPress={() => toggle(id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
              >
                <Icon size={18} weight="fill" color={on ? color.pos : color.neutral700} />
                <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Problem message={problem} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space[5] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: space[5] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 50,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral300,
  },
  chipOn: {
    backgroundColor: "#1c2a20",
    borderColor: "#4d6b4f",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  },
  chipPressed: { transform: [{ scale: 0.97 }] },
  chipLabel: { fontFamily: font.medium, fontSize: 16, color: color.neutral800 },
  chipLabelOn: { color: color.pos },
});
