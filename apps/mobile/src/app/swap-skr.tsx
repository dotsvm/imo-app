/**
 * Swap SKR to USDC: turn the Seeker's token into the cash markets trade in.
 * Jupiter finds the route; the API checks only your wallet signs it; your
 * wallet signs it here; the API relays exactly that.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUpRightIcon } from "phosphor-react-native/src/icons/ArrowUpRight";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import type { SkrQuoteDTO, SkrSwapDTO, SkrSwapReceiptDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { HoldButton } from "~/components/hold-button";
import { Rise } from "~/components/rise";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { skr, usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Step = "building" | "signing" | "sending";
const STEP: Record<Step, string> = {
  building: "Finding the best route…",
  signing: "Signing with your wallet…",
  sending: "Swapping on Solana…",
};

/** The typed amount, settled for a moment before it's quoted. */
function useSettled(value: number, ms = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export default function SwapSkr() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const trading = useTrading();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SkrSwapReceiptDTO | null>(null);

  const held = trading.info?.balance?.skr ?? null;
  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const settled = useSettled(value);
  const over = held !== null && value > held;
  const quote = useQuery({
    queryKey: ["skr-quote", settled],
    queryFn: ({ signal }) => api<SkrQuoteDTO>(`/wallet/skr/quote?skr=${settled}`, { signal }),
    enabled: trading.live && settled > 0 && !over,
    staleTime: 10_000,
  });
  const ready = value > 0 && !over && trading.wallet.status === "ready";

  async function swap() {
    if (trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setProblem(null);
    try {
      setStep("building");
      const built = await api<SkrSwapDTO>("/wallet/skr/swap", { body: { skr: value } });
      setStep("signing");
      const signed = await trading.wallet.sign(built.transaction);
      setStep("sending");
      const done = await api<SkrSwapReceiptDTO>("/wallet/skr/swap/submit", { body: { signedTransaction: signed } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setReceipt(done);
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The swap didn't go through. Nothing was sent.");
    } finally {
      setStep(null);
    }
  }

  if (receipt)
    return (
      <View style={[styles.screen, styles.doneScreen, { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[4] }]}>
        <Rise>
          <View style={styles.doneMark}>
            <CheckIcon size={26} weight="bold" color={PRIMARY_INK} />
          </View>
        </Rise>
        <Rise delay={60}>
          <Text style={styles.doneTitle}>{receipt.status === "confirmed" ? "Swapped" : "On its way"}</Text>
          <Text style={styles.doneAmount}>{usd(receipt.usdcCents)} USDC</Text>
          <Text style={[styles.small, { textAlign: "center" }]}>for {skr(receipt.skr)} SKR</Text>
        </Rise>
        <View style={{ flex: 1 }} />
        <Button
          variant="outline"
          label="View on Solscan"
          onPress={() => Linking.openURL(`https://solscan.io/tx/${receipt.signature}`)}
          icon={<ArrowUpRightIcon size={15} weight="bold" color={color.text} />}
          style={{ alignSelf: "stretch" }}
        />
        <Button label="Done" size="lg" onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
      </View>
    );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Swap SKR to USDC</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[6] }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>You swap</Text>
        <View style={styles.amountRow}>
          <TextInput
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
            placeholder="0"
            placeholderTextColor={color.neutral500}
            keyboardType="decimal-pad"
            style={styles.amount}
            accessibilityLabel="Amount of SKR"
          />
          <Text style={styles.unit}>SKR</Text>
          <Pressable onPress={() => held !== null && setAmount(String(held))} disabled={!held} style={styles.max} accessibilityRole="button">
            <Text style={styles.maxText}>Max</Text>
          </Pressable>
        </View>
        <Text style={[styles.small, over && { color: color.neg }]}>
          {held === null ? " " : `${skr(held)} SKR in your wallet`}
        </Text>

        <View style={styles.facts}>
          <Fact
            label="You get about"
            value={value <= 0 || over ? "—" : quote.data && settled === value ? `${usd(quote.data.usdcCents)} USDC` : "…"}
          />
          <Fact label="At least" value={quote.data && settled === value && !over ? `${usd(quote.data.minUsdcCents)} USDC` : "—"} />
          <Fact label="Route" value="Jupiter · best price" />
          <Fact label="Network fee" value="< $0.01 in SOL" last />
        </View>
        {quote.isError ? <Text style={styles.problem}>{(quote.error as Error).message}</Text> : null}
        <Text style={styles.note}>The price can move up to 1% before the swap lands; you’ll never get less than “at least”.</Text>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <HoldButton label={value ? `Hold to swap ${skr(value)} SKR` : "Hold to swap"} onComplete={swap} loading={step !== null} disabled={!ready} />
        {step ? <Text style={styles.step}>{STEP[step]}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factLine]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], marginBottom: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 18, letterSpacing: -0.3, color: color.text },
  body: { paddingHorizontal: space[4], gap: space[2] },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amount: { flex: 1, fontFamily: font.medium, fontSize: 44, letterSpacing: -1.4, color: color.text, paddingVertical: 4, fontVariant: ["tabular-nums"] },
  unit: { fontFamily: font.medium, fontSize: 20, color: color.neutral600 },
  max: { height: 32, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral300 },
  maxText: { fontFamily: font.medium, fontSize: 13, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  facts: { marginTop: space[4] },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  factLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  factLabel: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  factValue: { fontFamily: font.medium, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  note: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.neutral700, marginVertical: space[3] },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg, marginBottom: space[2] },
  step: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, textAlign: "center", marginTop: space[3] },
  doneScreen: { alignItems: "center", paddingHorizontal: space[4], gap: space[3] },
  doneMark: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: color.pos },
  doneTitle: { fontFamily: font.medium, fontSize: 15, color: color.neutral700, textAlign: "center", marginTop: space[2] },
  doneAmount: { fontFamily: font.medium, fontSize: 40, letterSpacing: -1.4, color: color.text, textAlign: "center" },
});
