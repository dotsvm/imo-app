/**
 * New prediction: a market, a side, your reasoning (up to 600 characters) and
 * how sure you are. If you hold the side you're calling, your position shows
 * on the post (as your settings say).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { MinusIcon } from "phosphor-react-native/src/icons/Minus";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type { PortfolioDTO } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { VenueMark } from "~/components/venue-mark";
import { useMe } from "~/features/auth/use-account";
import { clearDraft, type Confidence, updateDraft, useDraft } from "~/features/compose/draft";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { bestAsk } from "~/lib/market";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

const LEVELS: Confidence[] = ["Low", "Medium", "High"];
const MAX = 600;

export default function Compose() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const venues = useVenues();
  const me = useMe().data;
  const draft = useDraft();
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }),
  });
  const m = draft.market;
  const held = m ? portfolio.data?.positions.find((p) => p.marketId === m.id && p.outcome === draft.outcome) : undefined;
  const disclose = !!held && (me?.settings.showPositionsOnPosts ?? true);
  const length = draft.text.trim().length;
  const ready = !!m && length > 0 && length <= MAX;
  const venue = m ? venues.get(m.venueId) : undefined;
  const level = LEVELS.indexOf(draft.confidence);

  function close() {
    clearDraft();
    router.back();
  }

  async function publish() {
    if (!m || !ready) return;
    setPublishing(true);
    setProblem(null);
    try {
      await api("/posts", {
        body: {
          market: m.id,
          outcome: draft.outcome,
          text: draft.text.trim(),
          confidence: draft.confidence,
          disclosePosition: disclose,
          clientId: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
      close();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your prediction didn't post. Try again.");
      setPublishing(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? space[3] : insets.top + space[2] }]}>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New prediction</Text>
        <Button size="sm" label="Publish" onPress={publish} disabled={!ready} loading={publishing} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => router.push("/pick-market")}
          style={({ pressed }) => [styles.market, pressed && styles.marketPressed]}
          accessibilityRole="button"
          accessibilityLabel={m ? `Market: ${m.title}. Change` : "Choose a market"}
        >
          {m ? (
            <>
              <VenueMark venueId={m.venueId} size={36} />
              <View style={styles.marketText}>
                <Text style={styles.marketTitle} numberOfLines={1}>
                  {m.shortTitle || m.title}
                </Text>
                <Text style={styles.marketMeta}>
                  {venue?.name ?? m.venueId} · Yes {price(bestAsk(m, "Yes"))} · No {price(bestAsk(m, "No"))}
                </Text>
              </View>
              <Text style={styles.change}>Change</Text>
            </>
          ) : (
            <>
              <View style={[styles.mark, styles.markEmpty]}>
                <PlusIcon size={16} weight="bold" color={color.neutral700} />
              </View>
              <Text style={[styles.marketTitle, styles.marketText]}>Choose a market</Text>
            </>
          )}
        </Pressable>

        <View style={styles.sides}>
          {(["Yes", "No"] as const).map((side) => {
            const on = draft.outcome === side;
            return (
              <Pressable
                key={side}
                onPress={() => updateDraft({ outcome: side })}
                style={[styles.side, on && (side === "Yes" ? styles.sideYes : styles.sideNo)]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                {on ? <CheckIcon size={15} weight="bold" color={side === "Yes" ? color.pos : color.neg} /> : null}
                <Text style={[styles.sideText, on && { color: side === "Yes" ? color.pos : color.neg }]}>
                  {side}
                  {m ? ` · ${price(bestAsk(m, side))}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={draft.text}
          onChangeText={(t) => updateDraft({ text: t })}
          placeholder="What’s your read, and why? Say what would change your mind."
          placeholderTextColor={color.neutral600}
          multiline
          maxLength={MAX}
          autoFocus
          style={styles.input}
          accessibilityLabel="Your prediction"
        />
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <View style={styles.conviction}>
          <Bars level={level} />
          <View style={styles.convictionText}>
            <Text style={styles.convictionTitle}>{draft.confidence} conviction</Text>
            <Text style={styles.convictionHint}>Shown on your post</Text>
          </View>
          <Stepper
            label="Less sure"
            disabled={level === 0}
            onPress={() => updateDraft({ confidence: LEVELS[level - 1]! })}
            icon={<MinusIcon size={14} weight="bold" color={color.text} />}
          />
          <Stepper
            label="More sure"
            disabled={level === LEVELS.length - 1}
            onPress={() => updateDraft({ confidence: LEVELS[level + 1]! })}
            icon={<PlusIcon size={14} weight="bold" color={color.text} />}
          />
        </View>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.status}>
          <Text style={styles.statusText} numberOfLines={1}>
            {held && disclose
              ? `Shows your ${Math.round(held.shares).toLocaleString("en-US")} ${held.outcome} @ ${price(Math.round((held.costCents / held.shares) * 10) / 10)}`
              : m
                ? `No ${draft.outcome} position to show`
                : "Choose a market to publish"}
          </Text>
          <Text style={[styles.statusText, length >= MAX && styles.short]}>
            {length} / {MAX}
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bars({ level }: { level: number }) {
  return (
    <View style={styles.bars} accessibilityElementsHidden>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.bar, { height: 7 + i * 5 }, i <= level && styles.barOn]} />
      ))}
    </View>
  );
}

function Stepper({ label, onPress, disabled, icon }: { label: string; onPress: () => void; disabled: boolean; icon: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.step, pressed && styles.stepPressed, disabled && styles.stepOff]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  cancel: { fontFamily: font.regular, fontSize: text.post, color: color.neutral800 },
  title: { fontFamily: font.medium, fontSize: 16, color: color.text },
  body: { paddingHorizontal: space[4], gap: space[3], paddingBottom: space[5] },
  market: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: radius.panel,
    backgroundColor: color.surface,
  },
  marketPressed: { backgroundColor: color.neutral200 },
  mark: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  markEmpty: { backgroundColor: color.neutral300 },
  marketText: { flex: 1, gap: 4 },
  marketTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  marketMeta: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  sides: { flexDirection: "row", padding: 4, borderRadius: radius.pill, backgroundColor: color.neutral100 },
  side: { flex: 1, height: 42, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  sideYes: { backgroundColor: "#1c2a20", borderWidth: 1, borderColor: "#4d6b4f" },
  sideNo: { backgroundColor: "#2a1d1a", borderWidth: 1, borderColor: color.negLine },
  sideText: { fontFamily: font.medium, fontSize: text.post, color: color.neutral700, fontVariant: ["tabular-nums"] },
  input: { minHeight: 160, fontFamily: font.regular, fontSize: 18, lineHeight: 27, color: color.text, textAlignVertical: "top", paddingTop: space[2] },
  foot: { paddingHorizontal: space[4], paddingTop: space[2], gap: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.divider },
  conviction: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: radius.panel, backgroundColor: color.surface },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 17, paddingLeft: 2 },
  bar: { width: 5, borderRadius: 2, backgroundColor: color.neutral500 },
  barOn: { backgroundColor: color.pos },
  convictionText: { flex: 1, gap: 2 },
  convictionTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  convictionHint: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  step: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: color.neutral500, alignItems: "center", justifyContent: "center" },
  stepPressed: { backgroundColor: color.neutral300 },
  stepOff: { opacity: 0.35 },
  status: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  statusText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  short: { color: color.gold },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
});
