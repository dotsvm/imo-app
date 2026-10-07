/**
 * Deposit crypto: your wallet's Solana address, as a QR code and text, for
 * USDC (what trades spend) or SOL (what network fees spend). While open it
 * watches the wallet and says when the money lands.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CopySimpleIcon } from "phosphor-react-native/src/icons/CopySimple";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import type { WalletDTO } from "@imo/server/dto/api-types";
import { PRIMARY_INK } from "~/components/button";
import { Rise } from "~/components/rise";
import { Skeleton } from "~/components/skeleton";
import { useTrading } from "~/features/wallet/use-trading";
import { TOKEN_LOGOS } from "~/lib/logos";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Token = "USDC" | "SOL";
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const sol = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });

export default function Deposit() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const trading = useTrading();
  const [token, setToken] = useState<Token>("USDC");
  const [copied, setCopied] = useState(false);
  // What the wallet held when this screen opened, to spot what arrives.
  const [start, setStart] = useState<{ usdc: number; sol: number } | null>(null);

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: ({ signal }) => api<WalletDTO>("/wallet", { signal }),
    enabled: trading.live,
    refetchInterval: 5_000,
  });
  const address = wallet.data?.address;
  const balance = wallet.data?.balance;
  if (balance && !start) setStart({ usdc: balance.usdcCents, sol: balance.solLamports });
  const arrivedUsdc = balance && start ? balance.usdcCents - start.usdc : 0;
  const arrivedSol = balance && start ? balance.solLamports - start.sol : 0;
  const arrived = arrivedUsdc > 0 || arrivedSol > 0;

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Deposit crypto</Text>
        <View style={styles.network}>
          <Image source={TOKEN_LOGOS.SOL} style={styles.networkLogo} accessibilityIgnoresInvertColors />
          <Text style={styles.networkText}>Solana</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[6] }]}>
        <View style={styles.tokens}>
          {(["USDC", "SOL"] as const).map((t) => {
            const on = t === token;
            return (
              <Pressable
                key={t}
                onPress={() => setToken(t)}
                style={[styles.token, on && styles.tokenOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Image source={TOKEN_LOGOS[t]} style={styles.tokenMark} accessibilityIgnoresInvertColors />
                <View>
                  <Text style={[styles.tokenName, on && styles.tokenNameOn]}>{t}</Text>
                  <Text style={[styles.tokenNote, on && styles.tokenNoteOn]}>{t === "USDC" ? "Recommended" : "For network fees"}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {arrived ? (
          <Rise>
            <View style={styles.arrived} accessibilityLiveRegion="polite">
              <CheckIcon size={15} weight="bold" color={color.pos} />
              <Text style={styles.arrivedText}>
                {arrivedUsdc > 0 ? `${usd(arrivedUsdc)} USDC arrived` : `${sol(arrivedSol)} SOL arrived`} · now {usd(balance!.usdcCents)} to trade
              </Text>
            </View>
          </Rise>
        ) : null}

        <View style={styles.qrWrap}>
          {address ? (
            <View style={styles.qr} accessibilityLabel={`QR code of your ${token} deposit address`}>
              <QRCode value={address} size={168} color="#090d0b" backgroundColor="#f2f1ec" quietZone={8} />
            </View>
          ) : (
            <Skeleton width={184} height={184} style={{ borderRadius: radius.drawer }} />
          )}
        </View>

        <Text style={styles.label}>Your {token} deposit address</Text>
        <View style={styles.addressRow}>
          <Text style={styles.address} numberOfLines={1} selectable>
            {address ? short(address) : " "}
          </Text>
          <Pressable onPress={copy} disabled={!address} style={styles.copy} accessibilityRole="button" accessibilityLabel="Copy address">
            {copied ? <CheckIcon size={13} weight="bold" color={PRIMARY_INK} /> : <CopySimpleIcon size={13} weight="bold" color={PRIMARY_INK} />}
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        </View>

        <View style={styles.warn}>
          <WarningCircleIcon size={16} weight="fill" color={color.gold} />
          <Text style={styles.warnText}>
            Only send {token} on the Solana network. Other tokens or networks will be lost.
          </Text>
        </View>

        <View style={styles.facts}>
          <Fact label={token === "USDC" ? "Minimum" : "Suggested"} value={token === "USDC" ? `Any · trades from ${usd(trading.minOrderCents)}` : "About 0.02 SOL"} />
          <Fact label="Arrives in" value="Seconds after it's sent" />
          <Fact label="Fee" value="Free" />
          <Fact
            label="In your wallet"
            value={balance ? (token === "USDC" ? `${usd(balance.usdcCents)} USDC` : `${sol(balance.solLamports)} SOL`) : wallet.data ? "Unavailable" : "—"}
            last
          />
        </View>

        <Pressable onPress={() => queryClient.invalidateQueries({ queryKey: ["wallet"] })} style={styles.refresh} accessibilityRole="button">
          <Text style={styles.refreshText}>Checking for deposits every few seconds</Text>
        </Pressable>
      </ScrollView>
    </View>
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
  body: { paddingHorizontal: space[4], gap: space[4] },
  tokens: { flexDirection: "row", gap: space[2] },
  token: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 52, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "#141a17" },
  tokenOn: { backgroundColor: "#eceadf" },
  tokenMark: { width: 28, height: 28, borderRadius: 14 },
  tokenName: { fontFamily: font.medium, fontSize: 14, color: color.text },
  tokenNameOn: { color: PRIMARY_INK },
  tokenNote: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  tokenNoteOn: { color: "#4a5148" },
  arrived: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.card, backgroundColor: color.pos100, borderWidth: StyleSheet.hairlineWidth, borderColor: color.posLine },
  arrivedText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.pos },
  qrWrap: { alignItems: "center", paddingVertical: space[2] },
  qr: { padding: 8, borderRadius: radius.drawer, backgroundColor: "#f2f1ec" },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginBottom: -space[2] },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    height: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radius.pill,
    backgroundColor: "#141a17",
  },
  address: { flex: 1, fontFamily: font.medium, fontSize: 14, letterSpacing: 0.2, color: color.text, fontVariant: ["tabular-nums"] },
  copy: { flexDirection: "row", alignItems: "center", gap: 5, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: "#eceadf" },
  copyText: { fontFamily: font.medium, fontSize: 13, color: PRIMARY_INK },
  warn: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: color.gold200 },
  warnText: { flex: 1, fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.gold },
  facts: { marginTop: space[1] },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 },
  factLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  factLabel: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  factValue: { fontFamily: font.medium, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  refresh: { alignSelf: "center", paddingVertical: space[2] },
  refreshText: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
});
