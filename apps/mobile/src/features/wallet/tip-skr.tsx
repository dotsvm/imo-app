/**
 * Tip a prediction's author in SKR, from your own wallet: pick an amount, hold
 * to send. The API builds the transfer to their wallet (you never see their
 * address), your wallet signs it here, and the API relays exactly that.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TipDTO, TipReceiptDTO, TipsDTO } from "@imo/server/dto/api-types";
import { HoldButton } from "~/components/hold-button";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { skr } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

const AMOUNTS = [10, 50, 100] as const;
type Step = "building" | "signing" | "sending";
const STEP: Record<Step, string> = {
  building: "Preparing the tip…",
  signing: "Signing with your wallet…",
  sending: "Sending on Solana…",
};

export function TipSkr({ postId, authorName, isYou }: { postId: string; authorName: string; isYou: boolean }) {
  const queryClient = useQueryClient();
  const trading = useTrading();
  const [amount, setAmount] = useState<number | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const tips = useQuery({
    queryKey: ["tips", postId],
    queryFn: ({ signal }) => api<TipsDTO>(`/posts/${postId}/tips`, { signal }),
  });
  const held = trading.info?.balance?.skr ?? null;

  if (!trading.live) return null;
  const total = tips.data && tips.data.count > 0 ? `${skr(tips.data.skr)} SKR from ${tips.data.count} tip${tips.data.count === 1 ? "" : "s"}` : null;
  if (isYou) return total ? <Text style={styles.total}>Tipped {total}</Text> : null;

  async function send() {
    if (!amount) return;
    if (trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setProblem(null);
    try {
      setStep("building");
      const built = await api<TipDTO>(`/posts/${postId}/tips`, { body: { skr: amount } });
      setStep("signing");
      const signed = await trading.wallet.sign(built.transaction);
      setStep("sending");
      const done = await api<TipReceiptDTO>(`/posts/${postId}/tips/submit`, { body: { signedTransaction: signed } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      queryClient.setQueryData(["tips", postId], done.tips);
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      setSent(done.skr);
      setAmount(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The tip didn't go through. Nothing was sent.");
    } finally {
      setStep(null);
    }
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Tip {authorName} in SKR</Text>
        {total ? <Text style={styles.small}>{total}</Text> : null}
      </View>
      <View style={styles.chips}>
        {AMOUNTS.map((n) => {
          const on = amount === n;
          const short = held !== null && n > held;
          return (
            <Pressable
              key={n}
              onPress={() => (setSent(null), setProblem(null), setAmount(on ? null : n))}
              disabled={short || step !== null}
              style={[styles.chip, on && styles.chipOn, short && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: short }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{n} SKR</Text>
            </Pressable>
          );
        })}
      </View>
      {amount ? <HoldButton label={`Hold to tip ${amount} SKR`} onComplete={send} loading={step !== null} disabled={step !== null} /> : null}
      {step ? <Text style={styles.small}>{STEP[step]}</Text> : null}
      {sent ? <Text style={[styles.small, { color: color.pos }]}>Sent {skr(sent)} SKR. Thanks for backing good calls.</Text> : null}
      {problem ? <Text style={[styles.small, { color: color.neg }]}>{problem}</Text> : null}
      {held !== null && held < AMOUNTS[0] && !sent ? (
        <Text style={styles.small}>You have {skr(held)} SKR. Send SKR to your wallet to tip.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space[3], marginTop: space[4], padding: space[4], borderRadius: radius.panel, backgroundColor: "#121714" },
  head: { gap: 2 },
  title: { fontFamily: font.medium, fontSize: text.ui, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  total: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[3] },
  chips: { flexDirection: "row", gap: space[2] },
  chip: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral300 },
  chipOn: { backgroundColor: color.pos },
  chipText: { fontFamily: font.medium, fontSize: 13, color: color.text, fontVariant: ["tabular-nums"] },
  chipTextOn: { color: "#183127" },
});
