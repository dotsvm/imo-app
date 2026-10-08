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
const BAR_HEIGHTS = [8, 14, 22];
/** Quiet hints and disabled steppers. */
const MUTED = "#94a197";

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
        <Text style={styles.title} accessibilityRole="header">
          New prediction
        </Text>
        <Pressable
          onPress={close}
          hitSlop={4}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancelHit, pressed && styles.cancelPressed]}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Button size="sm" style={styles.publish} label="Publish" onPress={publish} disabled={!ready} loading={publishing} />
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
                {on ? <CheckIcon size={13} weight="bold" color={side === "Yes" ? color.pos : color.neg} /> : null}
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
          selectionColor={color.pos}
          cursorColor={color.pos}
          multiline
          maxLength={MAX}
          autoFocus
          style={styles.input}
          accessibilityLabel="Your prediction"
        />
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <Pressable
          onPress={() => updateDraft({ confidence: LEVELS[(level + 1) % LEVELS.length]! })}
          style={({ pressed }) => [styles.conviction, pressed && styles.convictionPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${draft.confidence} conviction. Tap to change`}
        >
          <Bars level={level} />
          <View style={styles.convictionText}>
            <Text style={styles.convictionTitle}>{draft.confidence} conviction</Text>
            <Text style={styles.convictionHint}>Tap to change · shown on your post</Text>
          </View>
          <Stepper
            label="Less sure"
            disabled={level === 0}
            onPress={() => updateDraft({ confidence: LEVELS[level - 1]! })}
            icon={<MinusIcon size={13} weight="bold" color={level === 0 ? MUTED : color.text} />}
          />
          <Stepper
            label="More sure"
            disabled={level === LEVELS.length - 1}
            onPress={() => updateDraft({ confidence: LEVELS[level + 1]! })}
            icon={<PlusIcon size={13} weight="bold" color={level === LEVELS.length - 1 ? MUTED : color.text} />}
          />
        </Pressable>
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
        <View key={i} style={[styles.bar, { height: BAR_HEIGHTS[i] }, i <= level && styles.barOn]} />
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
    gap: space[2],
    minHeight: 52,
    paddingLeft: space[2],
    paddingRight: space[3],
  },
  // Centered on the screen, whatever the widths of Cancel and Publish.
  title: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    lineHeight: 52,
    textAlign: "center",
    fontFamily: font.medium,
    fontSize: 15,
    color: color.text,
    pointerEvents: "none",
  },
  cancelHit: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center", borderRadius: radius.pill },
  cancelPressed: { backgroundColor: color.neutral200 },
  cancel: { fontFamily: font.regular, fontSize: 14, color: color.neutral800 },
  publish: { height: 38, paddingHorizontal: 18 },
  body: { flexGrow: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: 14, paddingBottom: 14 },
  market: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 16,
    backgroundColor: color.surface,
  },
  marketPressed: { backgroundColor: color.neutral200 },
  mark: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  markEmpty: { backgroundColor: color.neutral300 },
  marketText: { flex: 1, gap: 3 },
  marketTitle: { fontFamily: font.medium, fontSize: 14, color: color.text },
  marketMeta: { fontFamily: font.regular, fontSize: 11, color: color.neutral700, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.regular, fontSize: 12, color: MUTED },
  sides: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: color.surface },
  side: {
    flex: 1,
    height: 42,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  sideYes: { backgroundColor: color.pos200, borderColor: color.posLine },
  sideNo: { backgroundColor: color.neg200, borderColor: color.negLine },
  sideText: { fontFamily: font.medium, fontSize: 14, color: MUTED, fontVariant: ["tabular-nums"] },
  input: {
    flex: 1,
    minHeight: 160,
    fontFamily: font.regular,
    fontSize: 17,
    lineHeight: 25.5,
    color: color.text,
    textAlignVertical: "top",
    paddingTop: space[1],
  },
  foot: { paddingHorizontal: space[4], gap: space[3] },
  conviction: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: color.surface,
  },
  convictionPressed: { backgroundColor: color.neutral200 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 22, paddingLeft: 2 },
  bar: { width: 6, borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.14)" },
  barOn: { backgroundColor: color.pos },
  convictionText: { flex: 1, gap: 3 },
  convictionTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  convictionHint: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.neutral400,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPressed: { backgroundColor: color.neutral300 },
  stepOff: { opacity: 0.6 },
  status: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  statusText: { fontFamily: font.regular, fontSize: 11, color: MUTED, fontVariant: ["tabular-nums"] },
  short: { color: color.neg },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
});
