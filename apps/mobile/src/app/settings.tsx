/**
 * Settings: your profile; how you sign in, your wallet's USDC (and, on a
 * paper server, the demo balance and starting it over); what you get told
 * and what others see.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowCounterClockwiseIcon } from "phosphor-react-native/src/icons/ArrowCounterClockwise";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { FlaskIcon } from "phosphor-react-native/src/icons/Flask";
import { KeyIcon } from "phosphor-react-native/src/icons/Key";
import { PaletteIcon } from "phosphor-react-native/src/icons/Palette";
import { ShieldIcon } from "phosphor-react-native/src/icons/Shield";
import { SignOutIcon } from "phosphor-react-native/src/icons/SignOut";
import { TrophyIcon } from "phosphor-react-native/src/icons/Trophy";
import { WalletIcon } from "phosphor-react-native/src/icons/Wallet";
import type { PortfolioDTO, PreferencesDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { ScreenHeader } from "~/components/screen-header";
import { Toggle } from "~/components/toggle";
import { signOut, useConfig } from "~/features/auth/auth";
import { useMe } from "~/features/auth/use-account";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { usd, wholeDollars } from "~/lib/format";
import { color, font, radius } from "~/theme/tokens";

type Toggleable = "showPositionsOnPosts" | "privateOpenPositions" | "appearOnLeaderboard";
const METHODS: Record<string, string> = { email: "Email code", google: "Google", apple: "Apple", x: "X", wallet: "Wallet", dev: "Dev sign-in" };
const RULE = "rgba(255, 255, 255, 0.08)";
const FAINT = color.faint;

const icon = (Icon: typeof KeyIcon) => <Icon size={18} weight="fill" color={color.neutral800} />;

export default function Settings() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const config = useConfig().data;
  const trading = useTrading();
  const paper = !!config && config.trading !== "wallet";
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }) });
  const prefs = useQuery({ queryKey: ["notification-preferences"], queryFn: ({ signal }) => api<PreferencesDTO>("/me/notification-preferences", { signal }) });
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  async function toggle(key: Toggleable, value: boolean) {
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
  const start = config ? wholeDollars(config.paper.startingBalanceCents) : "$10,000";
  const theme = me?.settings.theme;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
        {me ? (
          <Pressable
            onPress={() => router.push("/edit-profile")}
            style={({ pressed }) => [styles.group, styles.profile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${me.user.displayName}, edit profile`}
          >
            <Avatar url={me.user.avatarUrl} size={52} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {me.user.displayName}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                @{me.user.handle} · Edit profile
              </Text>
            </View>
            <CaretRightIcon size={13} weight="bold" color={FAINT} />
          </Pressable>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.section}>Account</Text>
          <View style={styles.group}>
            <Row icon={icon(KeyIcon)} label="Login & security" value={me?.signIn.method ? (METHODS[me.signIn.method] ?? me.signIn.method) : "—"} />
            {/* Real money: the wallet's USDC ("—" while it can't be read, never $0). Paper: the demo balance. */}
            {trading.live ? (
              <Row
                icon={icon(WalletIcon)}
                label="Wallet"
                value={trading.availableCents !== null ? `${usd(trading.availableCents)} USDC` : "—"}
                onPress={() => router.push("/wallet")}
                last
              />
            ) : null}
            {paper ? (
              <Row icon={icon(FlaskIcon)} label="Demo balance" value={account ? usd(account.totalCents) : "—"} onPress={() => router.navigate("/portfolio")} last />
            ) : null}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.section}>Preferences</Text>
          <View style={styles.group}>
            <Row
              icon={icon(BellIcon)}
              label="Notifications"
              value={notifOn !== undefined ? `${notifOn} on` : ""}
              onPress={() => router.push("/notification-settings")}
            />
            <Row icon={icon(PaletteIcon)} label="Appearance" value={theme ? theme[0]!.toUpperCase() + theme.slice(1) : "Midnight"} />
            <ToggleRow
              icon={icon(EyeIcon)}
              label="Show P&L on my posts"
              value={me?.settings.showPositionsOnPosts ?? false}
              onChange={(v) => toggle("showPositionsOnPosts", v)}
            />
            <ToggleRow
              icon={icon(ShieldIcon)}
              label="Keep open positions private"
              value={me?.settings.privateOpenPositions ?? false}
              onChange={(v) => toggle("privateOpenPositions", v)}
            />
            <ToggleRow
              icon={icon(TrophyIcon)}
              label="Appear on the leaderboard"
              value={me?.settings.appearOnLeaderboard ?? true}
              onChange={(v) => toggle("appearOnLeaderboard", v)}
              last
            />
          </View>
        </View>

        <View style={styles.foot}>
          {/* Real money can't be reset: only a paper account starts over. */}
          {!paper ? null : confirming ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmTitle}>Start over with {start}?</Text>
              <Text style={styles.small}>Every position, order and result in this paper account is cleared. Your posts and record stay.</Text>
              <View style={styles.confirmRow}>
                <Button variant="surface" label="Keep it" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
                <Button label="Reset" onPress={reset} loading={resetting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => canReset && setConfirming(true)}
              disabled={!canReset}
              style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <ArrowCounterClockwiseIcon size={16} weight="bold" color={canReset ? color.neg : FAINT} />
              <Text style={[styles.pillText, !canReset && { color: FAINT }]}>
                {canReset ? `Reset demo to ${start}` : `Reset again after ${nextReset!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              </Text>
            </Pressable>
          )}
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <Pressable onPress={signOut} style={({ pressed }) => [styles.pill, pressed && styles.pressed]} accessibilityRole="button">
            <SignOutIcon size={16} weight="bold" color={color.neutral800} />
            <Text style={[styles.pillText, { color: color.neutral800 }]}>Sign out</Text>
          </Pressable>
          <Text style={styles.version}>
            imo {Constants.expoConfig?.version ?? ""} · {paper ? "simulated funds only" : "your wallet, your keys"}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value, onPress, last }: { icon: ReactNode; label: string; value?: string; onPress?: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && styles.pressed]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
    >
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <CaretRightIcon size={13} weight="bold" color={FAINT} /> : null}
    </Pressable>
  );
}

function ToggleRow({ icon, label, value, onChange, last }: { icon: ReactNode; label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      <Toggle value={value} onChange={onChange} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { paddingHorizontal: 16, gap: 18 },
  block: { gap: 6 },
  group: { borderRadius: 18, backgroundColor: color.card, overflow: "hidden" },
  pressed: { opacity: 0.85 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  profileName: { fontFamily: font.medium, fontSize: 16, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.muted },
  section: { fontFamily: font.regular, fontSize: 12, color: color.muted, paddingHorizontal: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingHorizontal: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: RULE },
  rowLabel: { flex: 1, fontFamily: font.regular, fontSize: 14, color: color.text },
  rowValue: { fontFamily: font.regular, fontSize: 13, color: color.muted, fontVariant: ["tabular-nums"] },
  foot: { alignItems: "center", gap: 10, paddingTop: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingHorizontal: 18, borderRadius: radius.pill },
  pillText: { fontFamily: font.regular, fontSize: 14, color: color.neg },
  confirm: { alignSelf: "stretch", gap: 12, padding: 16, borderRadius: 18, backgroundColor: color.card, borderWidth: 1, borderColor: color.negLine },
  confirmTitle: { fontFamily: font.medium, fontSize: 16, color: color.text },
  confirmRow: { flexDirection: "row", gap: 8 },
  problem: { fontFamily: font.regular, fontSize: 13, color: color.neg },
  version: { fontFamily: font.regular, fontSize: 11, color: FAINT },
});
