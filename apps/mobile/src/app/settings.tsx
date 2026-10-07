/**
 * Settings: your profile, how you signed in, your wallet (or, on a paper
 * server, the demo balance and starting it over), what you get told and
 * what others see.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowCounterClockwiseIcon } from "phosphor-react-native/src/icons/ArrowCounterClockwise";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { KeyIcon } from "phosphor-react-native/src/icons/Key";
import { PaletteIcon } from "phosphor-react-native/src/icons/Palette";
import { ShieldCheckIcon } from "phosphor-react-native/src/icons/ShieldCheck";
import { SignOutIcon } from "phosphor-react-native/src/icons/SignOut";
import { TrophyIcon } from "phosphor-react-native/src/icons/Trophy";
import { WalletIcon } from "phosphor-react-native/src/icons/Wallet";
import type { PortfolioDTO, PreferencesDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { signOut } from "~/features/auth/auth";
import { useMe } from "~/features/auth/use-account";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Toggle = "showPositionsOnPosts" | "privateOpenPositions" | "appearOnLeaderboard";
const METHODS: Record<string, string> = { email: "Email code", google: "Google", apple: "Apple", x: "X", wallet: "Wallet", dev: "Dev sign-in" };

export default function Settings() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }) });
  const prefs = useQuery({ queryKey: ["notification-preferences"], queryFn: ({ signal }) => api<PreferencesDTO>("/me/notification-preferences", { signal }) });
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const trading = useTrading();

  async function toggle(key: Toggle, value: boolean) {
    queryClient.setQueryData(["me"], (d: typeof me) => (d ? { ...d, settings: { ...d.settings, [key]: value } } : d));
    try {
      await api("/me", { method: "PATCH", body: { [key]: value } });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  }

  async function reset() {
    setResetting(true);
    setProblem(null);
    try {
      await api("/account/reset", { body: { confirm: "RESET" } });
      setConfirming(false);
      await Promise.all(["me", "portfolio", "trader", "position"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't reset. Try again.");
    } finally {
      setResetting(false);
    }
  }

  const account = portfolio.data?.account;
  const nextReset = account?.nextResetAt ? new Date(account.nextResetAt) : null;
  const canReset = !nextReset || nextReset.getTime() <= now;
  const notifOn = prefs.data?.items.filter((p) => p.app).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: insets.bottom + space[6] }}>
        {me ? (
          <Pressable onPress={() => router.push("/edit-profile")} style={[styles.group, styles.profile]} accessibilityRole="button" accessibilityLabel="Edit profile">
            <Avatar url={me.user.avatarUrl} size={48} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.profileName}>{me.user.displayName}</Text>
              <Text style={styles.small}>@{me.user.handle} · Edit profile</Text>
            </View>
            <CaretRightIcon size={16} color={color.neutral600} />
          </Pressable>
        ) : null}

        <Text style={styles.section}>Account</Text>
        <View style={styles.group}>
          <Row icon={<KeyIcon size={18} color={color.neutral800} />} label="Signed in with" value={me?.signIn.method ? METHODS[me.signIn.method] ?? me.signIn.method : "—"} />
          {trading.live ? (
            <Row
              icon={<WalletIcon size={18} color={color.neutral800} />}
              label="Wallet"
              value={trading.availableCents !== null ? `${usd(trading.availableCents)} USDC` : ""}
              onPress={() => router.push("/wallet")}
              last
            />
          ) : (
            <Row icon={<WalletIcon size={18} color={color.neutral800} />} label="Demo balance" value={account ? usd(account.totalCents) : "—"} onPress={() => router.navigate("/portfolio")} last />
          )}
        </View>

        <Text style={styles.section}>Preferences</Text>
        <View style={styles.group}>
          <Row
            icon={<BellIcon size={18} color={color.neutral800} />}
            label="Notifications"
            value={notifOn !== undefined ? `${notifOn} on` : ""}
            onPress={() => router.push("/notification-settings")}
          />
          <Row icon={<PaletteIcon size={18} color={color.neutral800} />} label="Appearance" value="Midnight" />
          <ToggleRow
            icon={<EyeIcon size={18} color={color.neutral800} />}
            label="Show my position on posts"
            value={me?.settings.showPositionsOnPosts ?? false}
            onChange={(v) => toggle("showPositionsOnPosts", v)}
          />
          <ToggleRow
            icon={<ShieldCheckIcon size={18} color={color.neutral800} />}
            label="Keep open positions private"
            value={me?.settings.privateOpenPositions ?? false}
            onChange={(v) => toggle("privateOpenPositions", v)}
          />
          <ToggleRow
            icon={<TrophyIcon size={18} color={color.neutral800} />}
            label="Appear on the leaderboard"
            value={me?.settings.appearOnLeaderboard ?? true}
            onChange={(v) => toggle("appearOnLeaderboard", v)}
            last
          />
        </View>

        <View style={styles.danger}>
          {/* Real money can't be reset: only a paper account starts over. */}
          {trading.live ? null : confirming ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmTitle}>Start over with $10,000?</Text>
              <Text style={styles.small}>Every position, order and result in this paper account is cleared. Your posts and record stay.</Text>
              <View style={styles.confirmRow}>
                <Button variant="outline" label="Keep it" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
                <Button label="Reset" onPress={reset} loading={resetting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Pressable onPress={() => canReset && setConfirming(true)} disabled={!canReset} style={styles.reset} accessibilityRole="button">
              <ArrowCounterClockwiseIcon size={16} color={canReset ? color.neg : color.neutral600} />
              <Text style={[styles.resetText, !canReset && { color: color.neutral600 }]}>
                {canReset ? "Reset demo to $10,000" : `Reset again after ${nextReset!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              </Text>
            </Pressable>
          )}
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <Pressable onPress={signOut} style={styles.reset} accessibilityRole="button">
            <SignOutIcon size={16} color={color.neutral800} />
            <Text style={[styles.resetText, { color: color.neutral800 }]}>Sign out</Text>
          </Pressable>
          <Text style={styles.foot}>
            imo {Constants.expoConfig?.version ?? ""} · {trading.live ? "real money · your wallet, your keys" : "simulated funds only"}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value, onPress, last }: { icon: ReactNode; label: string; value?: string; onPress?: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.row, !last && styles.rowLine]} accessibilityRole={onPress ? "button" : undefined}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <CaretRightIcon size={14} color={color.neutral600} /> : null}
    </Pressable>
  );
}

function ToggleRow({ icon, label, value, onChange, last }: { icon: ReactNode; label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.neutral400, true: "#7fd47a" }}
        thumbColor="#f3f1ea"
        ios_backgroundColor={color.neutral400}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], marginBottom: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.medium, fontSize: 26, letterSpacing: -0.7, color: color.text },
  group: { borderRadius: radius.panel, backgroundColor: "#121714", overflow: "hidden" },
  profile: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4] },
  profileName: { fontFamily: font.medium, fontSize: 16, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  section: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[5], marginBottom: space[2], marginLeft: space[1] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, paddingHorizontal: space[4] },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  rowLabel: { flex: 1, fontFamily: font.regular, fontSize: text.body + 1, color: color.text },
  rowValue: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700, fontVariant: ["tabular-nums"] },
  danger: { alignItems: "center", gap: space[2], marginTop: space[6] },
  reset: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: space[2] },
  resetText: { fontFamily: font.medium, fontSize: text.body + 1, color: color.neg },
  confirm: { alignSelf: "stretch", gap: space[3], padding: space[4], borderRadius: radius.panel, borderWidth: 1, borderColor: color.negLine },
  confirmTitle: { fontFamily: font.medium, fontSize: 16, color: color.text },
  confirmRow: { flexDirection: "row", gap: space[2] },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
  foot: { fontFamily: font.regular, fontSize: 11, color: color.neutral600, marginTop: space[2] },
});
