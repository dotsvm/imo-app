/**
 * Withdraw: send USDC from your wallet to any Solana address. The transfer
 * is built by the API, signed by your wallet here, and relayed exactly as
 * signed — a few seconds end to end.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { ArrowUpRightIcon } from "phosphor-react-native/src/icons/ArrowUpRight";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { ClipboardTextIcon } from "phosphor-react-native/src/icons/ClipboardText";
import type { WalletDTO, WithdrawalDTO, WithdrawalReceiptDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { HoldButton } from "~/components/hold-button";
import { Rise } from "~/components/rise";
import { useTrading } from "~/features/wallet/use-trading";
import { TOKEN_LOGOS } from "~/lib/logos";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;
type Step = "building" | "signing" | "sending";
const STEP: Record<Step, string> = {
  building: "Preparing the transfer…",
  signing: "Signing with your wallet…",
  sending: "Sending on Solana…",
};

export default function Withdraw() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const trading = useTrading();
  const wallet = useQuery({ queryKey: ["wallet"], queryFn: ({ signal }) => api<WalletDTO>("/wallet", { signal }), enabled: trading.live });
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [step, setStep] = useState<Step | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<WithdrawalReceiptDTO | null>(null);

  const balance = wallet.data?.balance;
  const available = balance?.usdcCents ?? null;
  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100) || 0;
  const validTo = BASE58.test(to.trim());
  const own = !!wallet.data && to.trim() === wallet.data.address;
  const over = available !== null && cents > available;
  const ready = cents > 0 && validTo && !own && !over && trading.wallet.status === "ready";

  async function paste() {
    const value = (await Clipboard.getStringAsync()).trim();
    if (value) setTo(value);
  }

  async function send() {
    if (trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setProblem(null);
    try {
      setStep("building");
      const built = await api<WithdrawalDTO>("/wallet/withdraw", { body: { to: to.trim(), amountCents: cents } });
      setStep("signing");
      const signed = await trading.wallet.sign(built.transaction);
      setStep("sending");
      const done = await api<WithdrawalReceiptDTO>("/wallet/withdraw/submit", { body: { signedTransaction: signed } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setReceipt(done);
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The withdrawal didn't go through. Nothing was sent.");
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
          <Text style={styles.doneTitle}>{receipt.status === "confirmed" ? "Sent" : "On its way"}</Text>
          <Text style={styles.doneAmount}>{usd(receipt.amountCents)} USDC</Text>
          <Text style={styles.small}>to {short(receipt.to)}</Text>
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
        <Text style={styles.title}>Withdraw</Text>
        <View style={styles.network}>
          <Image source={TOKEN_LOGOS.SOL} style={styles.networkLogo} accessibilityIgnoresInvertColors />
          <Text style={styles.networkText}>Solana</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[6] }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
            placeholder="0.00"
            placeholderTextColor={color.neutral500}
            keyboardType="decimal-pad"
            style={styles.amount}
            accessibilityLabel="Amount in dollars"
          />
          <Pressable
            onPress={() => available !== null && setAmount((available / 100).toFixed(2))}
            disabled={available === null}
            style={styles.max}
            accessibilityRole="button"
          >
            <Text style={styles.maxText}>Max</Text>
          </Pressable>
        </View>
        <Text style={[styles.small, over && { color: color.neg }]}>
          {available === null ? (wallet.data ? "Balance unavailable" : " ") : `${usd(available)} USDC available`}
        </Text>

        <Text style={[styles.label, { marginTop: space[4] }]}>To</Text>
        <View style={styles.toRow}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Solana address"
            placeholderTextColor={color.neutral600}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.toInput}
            accessibilityLabel="Recipient Solana address"
          />
          <Pressable onPress={paste} style={styles.paste} accessibilityRole="button" accessibilityLabel="Paste address">
            <ClipboardTextIcon size={15} color={color.neutral800} />
            <Text style={styles.pasteText}>Paste</Text>
          </Pressable>
        </View>
        {to && !validTo ? <Text style={[styles.small, { color: color.neg }]}>That isn’t a Solana address.</Text> : null}
        {own ? <Text style={[styles.small, { color: color.neg }]}>That’s your own wallet.</Text> : null}

        <View style={styles.facts}>
          <Fact label="Network" value="Solana" />
          <Fact label="Arrives in" value="Seconds" />
          <Fact label="Network fee" value="< $0.01 in SOL" />
          <Fact label="New address" value="+ ~0.002 SOL account rent" last />
        </View>
        <Text style={styles.warn}>
          Send only to a Solana address that accepts USDC — an exchange deposit address must be for USDC on Solana. Transfers can’t be reversed.
        </Text>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <HoldButton
          label={cents ? `Hold to withdraw ${usd(cents)}` : "Hold to withdraw"}
          onComplete={send}
          loading={step !== null}
          disabled={!ready}
        />
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
  network: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: color.neutral300 },
  networkLogo: { width: 14, height: 14, borderRadius: 7 },
  networkText: { fontFamily: font.medium, fontSize: 12, color: color.neutral800 },
  body: { paddingHorizontal: space[4], gap: space[2] },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dollar: { fontFamily: font.medium, fontSize: 40, color: color.neutral600 },
  amount: { flex: 1, fontFamily: font.medium, fontSize: 44, letterSpacing: -1.4, color: color.text, paddingVertical: 4, fontVariant: ["tabular-nums"] },
  max: { height: 32, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral300 },
  maxText: { fontFamily: font.medium, fontSize: 13, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  toRow: { flexDirection: "row", alignItems: "center", gap: space[2], height: 50, paddingLeft: 14, paddingRight: 6, borderRadius: radius.pill, backgroundColor: "#141a17" },
  toInput: { flex: 1, fontFamily: font.medium, fontSize: 14, color: color.text },
  paste: { flexDirection: "row", alignItems: "center", gap: 5, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: color.neutral300 },
  pasteText: { fontFamily: font.medium, fontSize: 13, color: color.neutral800 },
  facts: { marginTop: space[4] },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  factLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  factLabel: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  factValue: { fontFamily: font.medium, fontSize: text.ui, color: color.text },
  warn: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.gold, marginVertical: space[3] },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg, marginBottom: space[2] },
  step: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, textAlign: "center", marginTop: space[3] },
  doneScreen: { alignItems: "center", paddingHorizontal: space[4], gap: space[3] },
  doneMark: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: color.pos },
  doneTitle: { fontFamily: font.medium, fontSize: 15, color: color.neutral700, textAlign: "center", marginTop: space[2] },
  doneAmount: { fontFamily: font.medium, fontSize: 40, letterSpacing: -1.4, color: color.text, textAlign: "center" },
});
