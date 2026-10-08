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
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CopyIcon } from "phosphor-react-native/src/icons/Copy";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import type { WalletDTO } from "@imo/server/dto/api-types";
import { Rise } from "~/components/rise";
import { Skeleton } from "~/components/skeleton";
import { useTrading } from "~/features/wallet/use-trading";
import { TOKEN_LOGOS } from "~/lib/logos";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { color, font, radius, space } from "~/theme/tokens";

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
    <View style={[styles.screen, { paddingTop: insets.top + 2 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => [styles.back, pressed && { backgroundColor: color.card }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Deposit crypto</Text>
        <View style={styles.network}>
          <Image source={TOKEN_LOGOS.SOL} style={styles.networkLogo} accessibilityIgnoresInvertColors />
          <Text style={styles.networkText}>Solana</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[5] }]}>
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
                accessibilityLabel={`${t}, ${t === "USDC" ? "recommended" : "for network fees"}`}
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
              <QRCode value={address} size={176} color="#0c100e" backgroundColor="#f4f5f1" quietZone={0} />
            </View>
          ) : (
            <Skeleton width={204} height={204} style={{ borderRadius: 28 }} />
          )}
        </View>

        <Text style={styles.label}>Your {token} deposit address</Text>
        <View style={styles.addressRow}>
          <Text style={styles.address} numberOfLines={1} selectable accessibilityLabel={address ? `Address ${address}` : "Address loading"}>
            {address ? short(address) : " "}
          </Text>
          <Pressable onPress={copy} disabled={!address} style={styles.copy} accessibilityRole="button" accessibilityLabel="Copy address">
            {copied ? <CheckIcon size={14} weight="bold" color="#0c100e" /> : <CopyIcon size={14} weight="bold" color="#0c100e" />}
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
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: space[2], paddingRight: space[4], marginBottom: 6 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 16, color: color.text },
  network: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: color.card },
  networkLogo: { width: 14, height: 14, borderRadius: 7 },
  networkText: { fontFamily: font.regular, fontSize: 12, color: "#c9cfcb" },
  body: { paddingHorizontal: 20, paddingTop: space[2] },
  tokens: { flexDirection: "row", gap: space[2] },
  token: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 52, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: color.card },
  tokenOn: { backgroundColor: color.text },
  tokenMark: { width: 28, height: 28, borderRadius: 14 },
  tokenName: { fontFamily: font.semibold, fontSize: 14, color: color.text },
  tokenNameOn: { color: "#0c100e" },
  tokenNote: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  tokenNoteOn: { color: "#4a514d" },
  arrived: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: "rgba(111, 211, 143, 0.08)", borderWidth: 1, borderColor: "rgba(111, 211, 143, 0.22)" },
  arrivedText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.gain },
  qrWrap: { alignItems: "center", marginTop: 20 },
  qr: { padding: 14, borderRadius: 28, backgroundColor: "#f4f5f1", boxShadow: "0 20px 40px -18px rgba(0, 0, 0, 0.8)" },
  label: { fontFamily: font.regular, fontSize: 12, color: color.muted, marginTop: 20, marginBottom: space[2] },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    paddingLeft: space[4],
    paddingRight: 6,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  address: { flex: 1, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 13, color: color.text },
  copy: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.text },
  copyText: { fontFamily: font.semibold, fontSize: 13, color: "#0c100e" },
  warn: { flexDirection: "row", gap: 10, marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "rgba(226, 200, 146, 0.08)" },
  warnText: { flex: 1, fontFamily: font.regular, fontSize: 12, lineHeight: 17.4, color: color.gold },
  facts: { marginTop: 10 },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[3], minHeight: 44 },
  factLine: { borderBottomWidth: 1, borderBottomColor: "rgba(255, 255, 255, 0.08)" },
  factLabel: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  factValue: { flexShrink: 1, textAlign: "right", fontFamily: font.medium, fontSize: 13, color: color.text, fontVariant: ["tabular-nums"] },
  refresh: { alignSelf: "center", marginTop: space[3], paddingVertical: space[2] },
  refreshText: { fontFamily: font.regular, fontSize: 11, color: color.faint },
});
