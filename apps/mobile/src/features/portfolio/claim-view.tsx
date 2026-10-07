/**
 * A winning position, settled and waiting: what you called, what you get,
 * the profit against what you paid, how the market resolved — and the one
 * button that moves the payout into cash (with real money: a claim the
 * wallet signs, paid out to it). Then share it.
 */
import { useQueryClient } from "@tanstack/react-query";
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
import { usd } from "~/lib/format";
import type { Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";

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
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still connecting. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setClaiming(true);
    setProblem(null);
    try {
      if (trading.live && trading.wallet.status === "ready")
        await claimWithWallet(encodeURIComponent(positionId), trading.wallet.sign, setStep);
      else await api(`/positions/${encodeURIComponent(positionId)}/claim`, { method: "POST" });
      setClaimed(true);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["position"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't claim. Try again.");
    } finally {
      setClaiming(false);
      setStep(null);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <VenueBadge venueId={m.venueId} size={18} textStyle={styles.crumb} />
        <Text style={styles.crumb}>· resolved {resolvedOn}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {won ? (
          <View style={styles.called}>
            <CheckIcon size={13} weight="bold" color={color.pos} />
            <Text style={styles.calledText}>You called it</Text>
          </View>
        ) : null}
        <Text style={styles.small}>{claimed ? "Claimed" : "Ready to claim"}</Text>
        <Text style={styles.amount} accessibilityLabel={usd(payoutCents)}>
          {dollars}
          <Text style={styles.cents}>.{cents}</Text>
        </Text>
        <Text style={[styles.profit, { color: profit < 0 ? color.neg : color.pos }]}>
          {profit >= 0 ? "+" : "−"}
          {usd(Math.abs(profit))} profit <Text style={styles.small}>· {ret}% return</Text>
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{m.title}</Text>
          <Text style={styles.small}>
            Resolved <Text style={{ color: m.resolution.outcome === "Yes" ? color.pos : color.neg }}>{m.resolution.outcome ?? "void"}</Text>
            {m.resolution.source ? ` · ${m.resolution.source}` : ""}
          </Text>
        </View>

        <View style={styles.facts}>
          <Fact label="You held" value={`${shares.toLocaleString("en-US")} ${outcome}`} />
          <Fact label="You paid" value={usd(costCents)} />
          <Fact label="Fees" value={feeCents ? usd(feeCents) : "$0"} />
        </View>
        {claiming && step ? <Text style={styles.small}>{STEP_LABEL[step]}</Text> : null}
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        {claimed ? (
          <View style={styles.done}>
            <CheckIcon size={18} weight="bold" color={PRIMARY_INK} />
            <Text style={styles.doneText}>{usd(payoutCents)} {trading.live ? "paid to your wallet" : "added to your cash"}</Text>
          </View>
        ) : (
          <Button size="lg" label={`Claim ${usd(payoutCents)}`} onPress={claim} loading={claiming} />
        )}
        <Pressable
          onPress={() =>
            Share.share({
              message: `Called it on imo: ${m.title} resolved ${m.resolution.outcome}. ${profit >= 0 ? "+" : "−"}${usd(Math.abs(profit))} (${ret}%). ${API_URL}/market/${encodeURIComponent(m.id)}`,
            })
          }
          style={styles.share}
          accessibilityRole="button"
        >
          <ShareNetworkIcon size={16} color={color.text} />
          <Text style={styles.shareText}>Share your win</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
    experimental_backgroundImage: "radial-gradient(130% 70% at 20% 10%, rgba(181, 230, 161, 0.10) 0%, rgba(9, 13, 11, 0) 70%)",
  },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingBottom: space[2] },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  crumb: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  body: { paddingHorizontal: space[5], paddingTop: space[6], gap: space[2] },
  called: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#3f5a41",
    backgroundColor: "#16231a",
    marginBottom: space[4],
  },
  calledText: { fontFamily: font.medium, fontSize: 12, color: color.pos },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700, fontVariant: ["tabular-nums"] },
  amount: { fontFamily: font.medium, fontSize: 56, letterSpacing: -2, color: color.text, fontVariant: ["tabular-nums"] },
  cents: { color: color.neutral600 },
  profit: { fontFamily: font.medium, fontSize: text.body, fontVariant: ["tabular-nums"] },
  card: { gap: space[2], marginTop: space[5], padding: space[4], borderRadius: radius.panel, backgroundColor: "#121714" },
  cardTitle: { fontFamily: font.regular, fontSize: text.post, lineHeight: 22, color: color.text },
  facts: {
    flexDirection: "row",
    marginTop: space[5],
    paddingTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.neutral400,
  },
  factValue: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg, marginTop: space[3] },
  foot: { paddingHorizontal: space[5], gap: space[2] },
  done: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: "#b5e6a1",
  },
  doneText: { fontFamily: font.semibold, fontSize: 16, color: PRIMARY_INK },
  share: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: space[3] },
  shareText: { fontFamily: font.medium, fontSize: text.post, color: color.text },
});
