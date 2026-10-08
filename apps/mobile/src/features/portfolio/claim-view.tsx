/**
 * A winning position, settled and waiting: what you called, what you get,
 * the profit against what you paid, how the market resolved — and the one
 * button that moves the payout into cash (with real money: a claim the
 * wallet signs, paid out to it). Then share it.
 */
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { ShareNetworkIcon } from "phosphor-react-native/src/icons/ShareNetwork";
import type { MarketDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { VenueBadge } from "~/components/venue-badge";
import { claimWithWallet, STEP_LABEL, type OrderStep } from "~/features/wallet/orders";
import { useTrading } from "~/features/wallet/use-trading";
import { api, API_URL } from "~/lib/api";
import { signedUsd, usd } from "~/lib/format";
import type { Outcome } from "~/lib/market";
import { color, font, radius, space } from "~/theme/tokens";

interface Props {
  positionId: string;
  market: MarketDTO;
  outcome: Outcome;
  shares: number;
  costCents: number;
  feeCents: number;
  payoutCents: number;
}

export function ClaimView({ positionId, market: m, outcome, shares, costCents, feeCents, payoutCents }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<OrderStep | null>(null);
  const trading = useTrading();

  const paid = costCents + feeCents;
  const profit = payoutCents - paid;
  const ret = paid ? Math.round((profit / paid) * 100) : 0;
  const won = m.resolution.outcome === outcome;
  const resolvedOn = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const [dollars, cents] = usd(payoutCents).split(".");

  async function claim() {
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setClaiming(true);
    setProblem(null);
    setFailed(null);
    try {
      if (trading.live && trading.wallet.status === "ready")
        await claimWithWallet(encodeURIComponent(positionId), trading.wallet.sign, setStep);
      else await api(`/positions/${encodeURIComponent(positionId)}/claim`, { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setClaimed(true);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setFailed(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setClaiming(false);
      setStep(null);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        <View style={styles.crumbRow}>
          <VenueBadge venueId={m.venueId} size={16} textStyle={styles.crumb} />
          <Text style={styles.crumb}>· resolved {resolvedOn}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {won ? (
          <View style={styles.called}>
            <CheckIcon size={12} weight="bold" color={color.gain} />
            <Text style={styles.calledText}>You called it</Text>
          </View>
        ) : null}
        <Text style={[styles.small, { marginTop: won ? 20 : 0 }]}>{claimed ? "Claimed" : "Ready to claim"}</Text>
        <Text style={styles.amount} accessibilityLabel={usd(payoutCents)}>
          {dollars}
          <Text style={styles.cents}>.{cents}</Text>
        </Text>
        <Text style={[styles.profit, { color: profit < 0 ? color.neg : color.gain }]}>
          {profit >= 0 ? "+" : "−"}
          {usd(Math.abs(profit))} profit <Text style={styles.small}>· {ret}% return</Text>
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{m.title}</Text>
          <Text style={styles.cardSub}>
            Resolved{" "}
            <Text style={{ color: m.resolution.outcome === "Yes" ? color.gain : m.resolution.outcome === "No" ? color.neg : color.muted }}>
              {m.resolution.outcome ?? "void"}
            </Text>
            {m.resolution.source ? ` · ${m.resolution.source}` : ""}
          </Text>
        </View>

        <View style={styles.facts}>
          <Fact label="You held" value={`${shares.toLocaleString("en-US")} ${outcome}`} />
          <Fact label="You paid" value={usd(costCents)} />
          <Fact label={feeCents ? "Fees" : "Fee"} value={feeCents ? usd(feeCents) : "$0"} />
        </View>
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        {claimed ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            <Text style={styles.stateTitle}>
              {usd(payoutCents)} {trading.live ? "paid to your wallet" : "added to cash"}
            </Text>
            <Text style={styles.stateBody}>Realized P&amp;L {signedUsd(profit)} booked. Position moved to Closed.</Text>
          </View>
        ) : failed ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            <Text style={styles.stateTitle}>Claim didn’t go through</Text>
            <Text style={styles.stateBody}>Your payout is safe and still claimable. {failed}</Text>
          </View>
        ) : claiming && step ? (
          <Text style={[styles.small, styles.center]}>{STEP_LABEL[step]}</Text>
        ) : null}
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {claimed ? (
          <>
            <View style={styles.done}>
              <CheckIcon size={18} weight="bold" color={PRIMARY_INK} />
              <Text style={styles.doneText}>Claimed</Text>
            </View>
            <Button
              size="lg"
              variant="outline"
              label="View closed positions"
              onPress={() => router.navigate("/(tabs)/portfolio?list=closed")}
              style={styles.secondary}
            />
          </>
        ) : (
          <Button size="xl" label={failed ? "Retry claim" : `Claim ${usd(payoutCents)}`} onPress={claim} loading={claiming} />
        )}
        <Pressable
          onPress={() =>
            Share.share({
              message: `Called it on imo: ${m.title} resolved ${m.resolution.outcome}. ${profit >= 0 ? "+" : "−"}${usd(Math.abs(profit))} (${ret}%). ${API_URL}/market/${encodeURIComponent(m.id)}`,
            })
          }
          style={({ pressed }) => [styles.share, pressed && { backgroundColor: color.card }]}
          accessibilityRole="button"
        >
          <ShareNetworkIcon size={16} weight="bold" color={color.text} />
          <Text style={styles.shareText}>Share your win</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    experimental_backgroundImage: "radial-gradient(90% 45% at 50% 30%, rgba(111, 211, 143, 0.13) 0%, rgba(9, 13, 11, 0) 100%)",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, paddingHorizontal: space[2] },
  headerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerIconPressed: { backgroundColor: color.card },
  crumbRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  crumb: { fontFamily: font.regular, fontSize: 12, color: color.muted },
  body: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[4] },
  called: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(111, 211, 143, 0.3)",
    backgroundColor: "rgba(111, 211, 143, 0.12)",
  },
  calledText: { fontFamily: font.medium, fontSize: 12, color: color.gain },
  small: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  center: { textAlign: "center" },
  amount: { fontFamily: font.medium, fontSize: 64, lineHeight: 70, letterSpacing: -2.88, color: color.text, fontVariant: ["tabular-nums"], marginTop: 4 },
  cents: { color: color.muted },
  profit: { fontFamily: font.regular, fontSize: 14, fontVariant: ["tabular-nums"], marginTop: 10 },
  card: { gap: 10, marginTop: space[6], padding: space[4], borderRadius: 20, backgroundColor: color.card },
  cardTitle: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.text },
  cardSub: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.muted },
  facts: {
    flexDirection: "row",
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  factLabel: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  factValue: { fontFamily: font.medium, fontSize: 15, color: color.text, fontVariant: ["tabular-nums"] },
  problem: { fontFamily: font.regular, fontSize: 13, color: color.neg, textAlign: "center" },
  foot: { paddingHorizontal: space[5], gap: 10 },
  state: { gap: 4, alignItems: "center", paddingBottom: space[1] },
  stateTitle: { fontFamily: font.medium, fontSize: 14, color: color.text, textAlign: "center", fontVariant: ["tabular-nums"] },
  stateBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.muted, textAlign: "center", fontVariant: ["tabular-nums"] },
  done: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(111, 211, 143, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(111, 211, 143, 0.3)",
  },
  doneText: { fontFamily: font.semibold, fontSize: 16, color: color.gain },
  secondary: { backgroundColor: color.card, borderColor: "rgba(255, 255, 255, 0.12)" },
  share: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: radius.pill },
  shareText: { fontFamily: font.regular, fontSize: 14, color: color.text },
});
