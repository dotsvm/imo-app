/**
 * The way in: the promise, real calls from the feed, then every way to sign
 * in. A way this server hasn't switched on says so when tapped.
 */
import { Image } from "expo-image";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppleLogoIcon } from "phosphor-react-native/src/icons/AppleLogo";
import { GoogleLogoIcon } from "phosphor-react-native/src/icons/GoogleLogo";
import { XLogoIcon } from "phosphor-react-native/src/icons/XLogo";
import { Button } from "~/components/button";
import { Rise } from "~/components/rise";
import { type Provider, signInWith, useConfig } from "~/features/auth/auth";
import { Problem } from "~/features/auth/parts";
import { WelcomeCards } from "~/features/auth/welcome-cards";
import { wholeDollars } from "~/lib/format";
import { color, font, space, text } from "~/theme/tokens";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const config = useConfig();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Every way in is on the screen, as designed. One this server hasn't
  // switched on says so when tapped, instead of quietly vanishing.
  const social: Provider[] = ["apple", "google", "x"];
  const cash = config.data ? wholeDollars(config.data.paper.startingBalanceCents) : null;

  async function go(provider: Provider) {
    if (!config.data) return;
    setProblem(null);
    if (!config.data.supabase || !config.data.auth[provider]) {
      setProblem(`${NAMES[provider]} sign-in isn’t switched on for this server yet. Use email for now.`);
      return;
    }
    setBusy(provider);
    try {
      await signInWith(config.data, provider);
      // Signed in: the root layout moves on by itself.
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Sign-in didn't finish. Try again.");
    } finally {
      setBusy(null);
    }
  }


  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space[4]) }]}>
      <View style={styles.glow} />
      <WelcomeCards />
      <View style={styles.hero}>
        <Rise>
          <Image source={require("~/assets/brand/wordmark.png")} style={styles.wordmark} contentFit="contain" accessibilityLabel="imo" />
        </Rise>
        <Rise delay={60}>
          <Text style={styles.headline} accessibilityRole="header">
            Make the call. Let the market keep score.
          </Text>
        </Rise>
        {cash ? (
          <Rise delay={120}>
            <Text style={styles.lede}>
              {config.data?.trading === "wallet"
                ? "Trade real prediction markets from your own wallet."
                : `Paper-trade real markets with ${cash} demo cash.`}
            </Text>
          </Rise>
        ) : null}
      </View>

      <View style={styles.actions}>
        {config.isError ? (
          <>
            <Problem message="Can't reach imo. Check your connection." />
            <Button variant="outline" size="lg" label="Try again" onPress={() => config.refetch()} />
          </>
        ) : (
          <>
            {social.map((provider) => (
              <Button
                key={provider}
                variant={provider === "apple" ? "ivory" : "outline"}
                size="lg"
                loading={busy === provider}
                disabled={!!busy && busy !== provider}
                onPress={() => go(provider)}
                icon={ICONS[provider]}
                label={LABELS[provider]}
              />
            ))}
            <Pressable onPress={() => router.push("/email")} hitSlop={8} style={styles.emailLink} accessibilityRole="button">
              <Text style={styles.emailLinkText}>Use email instead</Text>
            </Pressable>
            <Problem message={problem} />
          </>
        )}
        <Text style={styles.legal}>By continuing you agree to the Terms and Privacy Policy.</Text>
      </View>
    </View>
  );
}

const ICONS: Record<Provider, ReactNode> = {
  apple: <AppleLogoIcon size={18} weight="fill" color="#0b0d0c" />,
  google: <GoogleLogoIcon size={17} weight="bold" color={color.text} />,
  x: <XLogoIcon size={16} weight="bold" color={color.text} />,
};
const NAMES: Record<Provider, string> = { apple: "Apple", google: "Google", x: "X" };
const LABELS: Record<Provider, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
  x: "Continue with X",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space[5] },
  // A faint green light from the top left, as in the design.
  glow: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
    experimental_backgroundImage:
      "radial-gradient(120% 60% at 15% 0%, rgba(181, 230, 161, 0.08) 0%, rgba(181, 230, 161, 0) 70%)",
  },
  hero: { paddingBottom: space[5] },
  // The wordmark file is 397×192.
  wordmark: { width: 74, height: 36, marginBottom: space[3] },
  headline: { fontFamily: font.semibold, fontSize: 34, lineHeight: 38, letterSpacing: -1, color: color.text },
  lede: { fontFamily: font.regular, fontSize: 16, lineHeight: 22, color: color.neutral700, marginTop: space[3] },
  actions: { gap: space[3] },
  emailLink: { alignSelf: "center", paddingVertical: space[2] },
  emailLinkText: { fontFamily: font.medium, fontSize: 16, color: color.text },
  legal: { fontFamily: font.regular, fontSize: text.label, color: color.neutral600, textAlign: "center", marginTop: space[2] },
});
