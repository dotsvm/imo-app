/**
 * Sell some or all of a position at the live bid: pick how much, see what
 * you'd get after fees, hold to sell. With real money the wallet signs the
 * venue's sell transaction and the proceeds land back in it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { QuoteDTO } from "@imo/server/dto/api-types";
import { HoldButton } from "~/components/hold-button";
import { placeWalletOrder, STEP_LABEL, type OrderStep } from "~/features/wallet/orders";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { price, signedUsd, usd } from "~/lib/format";
import type { Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";

interface Props {
  open: boolean;
  marketId: string;
  title: string;
  outcome: Outcome;
  shares: number;
  /** What the shares cost, fees in, for the profit line. */
  costCents: number;
  onClose: () => void;
  onSold: () => void;
}

const PARTS = [
  { id: 0.25, label: "25%" },
  { id: 0.5, label: "Half" },
  { id: 1, label: "All" },
];

export function SellSheet({ open, marketId, title, outcome, shares, costCents, onClose, onSold }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [part, setPart] = useState(1);
  const [selling, setSelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<OrderStep | null>(null);
  const trading = useTrading();
  // A fresh sheet each time it opens: the whole position, no leftover message.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPart(1);
      setProblem(null);
    }
  }
  // Wallet venues hold fractions of a share (16.66); "All" sells every one.
  const count = trading.live
    ? part === 1 ? shares : Math.max(0.01, Math.floor(shares * part * 100) / 100)
    : Math.max(1, Math.floor(shares * part));
  // The live-book preview prices whole shares.
  const previewShares = Math.max(1, Math.floor(count));

  const quote = useQuery({
    queryKey: ["quote", "sell", marketId, outcome, previewShares],
    queryFn: ({ signal }) => api<QuoteDTO>("/quotes", { body: { market: marketId, side: "Sell", outcome, shares: previewShares }, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const q = quote.data?.shares === previewShares ? quote.data : undefined;
  const basis = (costCents * count) / shares;
  // The preview priced whole shares; scale it to the fraction being sold.
  const k = count / previewShares;
  const getCents = q ? Math.round(q.totalCents * k) : 0;

  async function sell() {
    if (!q) return;
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setSelling(true);
    setProblem(null);
    try {
      const body = {
        market: marketId,
        side: "Sell" as const,
        outcome,
        shares: count,
        clientOrderId: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      };
      const order =
        trading.live && trading.wallet.status === "ready"
          ? await placeWalletOrder(body, trading.wallet.sign, setStep)
          : await api<{ status: string; filledShares: number; reason: string | null }>("/orders", {
              body: { ...body, expectedPriceCents: q.priceCents },
            });
      // Still filling after we stopped following: it's placed, not failed. The
      // portfolio's Orders list shows it until it fills; never sell twice.
      if (order.status !== "pending" && (order.status === "rejected" || order.status === "failed" || order.filledShares === 0))
        throw new Error(order.reason ?? "The sale didn't fill. Nothing changed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["position"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      ]);
      onSold();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The sale didn't go through. Try again.");
    } finally {
      setSelling(false);
      setStep(null);
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + space[2], 28) }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <Text style={styles.headText} numberOfLines={1}>
            Sell {outcome} · {title}
          </Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={16} weight="bold" color={color.neutral700} />
          </Pressable>
        </View>
        <Text style={styles.big}>
          {count.toLocaleString("en-US", { maximumFractionDigits: 2 })} {outcome}
          <Text style={styles.at}> at </Text>
          {q ? price(q.priceCents) : "—"}
        </Text>
        <View style={styles.parts}>
          {PARTS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPart(p.id)}
              style={[styles.part, part === p.id && styles.partOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: part === p.id }}
            >
              <Text style={[styles.partText, part === p.id && styles.partTextOn]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.lines}>
          <Line label={trading.live ? "You get, after fees (estimate)" : "You get, after fees"} value={q ? usd(getCents) : "—"} strong />
          <Line label="Fees" value={q ? usd(Math.round(q.feeCents * k)) : "—"} />
          <Line
            label="Profit on these shares"
            value={q ? signedUsd(Math.round(getCents - basis)) : "—"}
            tint={q ? (getCents - basis < 0 ? color.neg : getCents - basis > 0 ? color.gain : undefined) : undefined}
          />
        </View>
        {problem || quote.error ? <Text style={styles.problem}>{problem ?? (quote.error as Error).message}</Text> : null}
        <HoldButton
          label="Hold to sell"
          onComplete={sell}
          loading={selling}
          disabled={!q || quote.isFetching}
        />
        {selling && step ? <Text style={styles.fine}>{STEP_LABEL[step]}</Text> : null}
        <Text style={styles.fine}>
          {trading.live
            ? "Sells at the live bid through Jupiter; the USDC lands back in your wallet."
            : "Sells at the live bid; cancels if it drops more than 2¢ first. Simulated funds."}
        </Text>
      </View>
    </Modal>
  );
}

function Line({ label, value, strong, tint }: { label: string; value: string; strong?: boolean; tint?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: space[4],
    paddingHorizontal: space[5],
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#0c100e",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 -20px 60px rgba(0, 0, 0, 0.6)",
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.14)", marginBottom: -2 },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  headText: { flex: 1, fontFamily: font.regular, fontSize: text.ui, color: color.text },
  close: { width: 44, height: 44, marginVertical: -14, marginRight: -14, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  big: { fontFamily: font.medium, fontSize: 32, letterSpacing: -1, color: color.text, fontVariant: ["tabular-nums"] },
  at: { color: color.neutral600 },
  parts: { flexDirection: "row", gap: space[2] },
  part: { height: 36, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  partOn: { backgroundColor: "#eceadf" },
  partText: { fontFamily: font.medium, fontSize: text.body, color: color.neutral800 },
  partTextOn: { color: "#0b0d0c" },
  lines: { borderTopWidth: 1, borderTopColor: "rgba(255, 255, 255, 0.08)", paddingTop: space[2] },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  lineLabel: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  lineValue: { fontFamily: font.regular, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  lineStrong: { fontFamily: font.medium, fontSize: text.post },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
  fine: { fontFamily: font.regular, fontSize: 11, color: color.neutral700, textAlign: "center" },
});
