/**
 * Your wallet: the Solana address your trades are paid from, what it holds
 * (USDC to trade with, a little SOL for network fees), and how to add funds.
 * It's yours — imo never holds the key or the money.
 */
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CopySimpleIcon } from "phosphor-react-native/src/icons/CopySimple";
import { ShareNetworkIcon } from "phosphor-react-native/src/icons/ShareNetwork";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { useTrading } from "~/features/wallet/use-trading";
import { usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

/** Enough SOL for a few dozen trades' network fees and new accounts' rent. */
const LOW_SOL_LAMPORTS = 5_000_000;
const sol = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

export default function Wallet() {
  const insets = useSafeAreaInsets();
  const trading = useTrading();
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const info = trading.info;
  const address = info?.address;
  const balance = info?.balance;
  // The device's signer must be the wallet the server trades for.
  const mismatch = trading.wallet.status === "ready" && address && trading.wallet.address !== address;

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  }

  async function refresh() {
    setRefreshing(true);
    await trading.refresh().catch(() => {});
    setRefreshing(false);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Wallet</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: insets.bottom + space[6] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={color.neutral600} />}
      >
        {!trading.live ? (
          <Text style={styles.note}>This server trades paper money: there’s no wallet to fund.</Text>
        ) : (
          <>
            <Text style={styles.small}>USDC to trade with</Text>
            {info ? (
              <Text style={styles.balance} accessibilityLabel={balance ? usd(balance.usdcCents) : "Balance unavailable"}>
                {balance ? usd(balance.usdcCents) : "—"}
              </Text>
            ) : (
              <Skeleton width={160} height={44} style={{ marginVertical: 6 }} />
            )}
            <Text style={[styles.small, balance && balance.solLamports < LOW_SOL_LAMPORTS ? { color: color.gold } : null]}>
              {balance
                ? `${sol(balance.solLamports)} SOL for network fees${balance.solLamports < LOW_SOL_LAMPORTS ? " · add ~0.02 SOL" : ""}`
                : info
                  ? "Couldn't read the balance just now. Pull to refresh."
                  : " "}
            </Text>

            <View style={styles.card}>
              {address ? (
                <View style={styles.qr} accessibilityLabel="QR code of your wallet address">
                  <QRCode value={address} size={184} color="#090d0b" backgroundColor="#eeefea" quietZone={10} />
                </View>
              ) : (
                <Skeleton width={204} height={204} style={{ alignSelf: "center", borderRadius: radius.card }} />
              )}
              <Text style={styles.label}>Your Solana address</Text>
              <Text style={styles.address} selectable numberOfLines={2}>
                {address ?? " "}
              </Text>
              <View style={styles.actions}>
                <Button
                  label={copied ? "Copied" : "Copy address"}
                  size="sm"
                  onPress={copy}
                  disabled={!address}
                  style={{ flex: 1 }}
                >
                  {copied ? <CheckIcon size={15} weight="bold" color="#183127" /> : <CopySimpleIcon size={15} weight="bold" color="#183127" />}
                </Button>
                <Pressable
                  onPress={() => address && Share.share({ message: address })}
                  disabled={!address}
                  style={styles.share}
                  accessibilityRole="button"
                  accessibilityLabel="Share address"
                >
                  <ShareNetworkIcon size={18} color={color.text} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.section}>Add funds</Text>
            <View style={styles.steps}>
              <Step n={1} text="Send USDC on the Solana network to the address above — from an exchange or another wallet." />
              <Step n={2} text="Send a little SOL too (about 0.02) to pay network fees." />
              <Step n={3} text={`Trade from $${((trading.minOrderCents ?? 500) / 100).toFixed(0)}. Winnings and sales come back here.`} />
            </View>
            <Text style={styles.warn}>
              Only send USDC or SOL on Solana. Tokens sent from other networks can’t be recovered.
            </Text>

            <Text style={styles.section}>Signing</Text>
            <View style={styles.signer}>
              <View style={[styles.dot, { backgroundColor: trading.wallet.status === "ready" && !mismatch ? color.pos : color.neutral600 }]} />
              <Text style={styles.signerText}>
                {trading.wallet.status === "ready"
                  ? mismatch
                    ? `This device signs for ${short(trading.wallet.address)}, not this account's wallet. Sign out and back in.`
                    : "This device can sign your trades. The key stays in Privy's secure enclave."
                  : trading.wallet.status === "loading"
                    ? "Loading your wallet…"
                    : trading.wallet.reason}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Step({ n, text: body }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNo}>
        <Text style={styles.stepNoText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], marginBottom: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.medium, fontSize: 26, letterSpacing: -0.7, color: color.text },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.neutral700 },
  balance: { fontFamily: font.medium, fontSize: 44, letterSpacing: -1.6, color: color.text, fontVariant: ["tabular-nums"], marginVertical: 2 },
  note: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700, marginTop: space[4] },
  card: { marginTop: space[5], padding: space[4], gap: space[3], borderRadius: radius.panel, backgroundColor: "#121714" },
  qr: { alignSelf: "center", padding: 0, borderRadius: radius.card, overflow: "hidden" },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[1] },
  address: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.text, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", alignItems: "center", gap: space[2] },
  share: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.neutral300,
  },
  section: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[6], marginBottom: space[3], marginLeft: space[1] },
  steps: { gap: space[3] },
  step: { flexDirection: "row", gap: space[3], alignItems: "flex-start" },
  stepNo: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral300 },
  stepNoText: { fontFamily: font.medium, fontSize: 12, color: color.neutral800 },
  stepText: { flex: 1, fontFamily: font.regular, fontSize: text.body, lineHeight: 21, color: color.neutral800 },
  warn: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.gold, marginTop: space[4] },
  signer: { flexDirection: "row", gap: space[3], alignItems: "flex-start", padding: space[4], borderRadius: radius.panel, backgroundColor: "#121714" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  signerText: { flex: 1, fontFamily: font.regular, fontSize: text.ui, lineHeight: 19, color: color.neutral800 },
});
