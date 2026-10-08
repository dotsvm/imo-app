/**
 * The way in: real calls from the feed, the promise, then the ways to sign
 * in this server has switched on — Apple, Google, X (each only when it's
 * on), and email. No wallet sign-in: every account gets its wallet itself.
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
import { Skeleton } from "~/components/skeleton";
import { type Provider, signInWith, useConfig } from "~/features/auth/auth";
import { Problem } from "~/features/auth/parts";
import { WelcomeCards } from "~/features/auth/welcome-cards";
import { wholeDollars } from "~/lib/format";
import { color, font } from "~/theme/tokens";

const PROVIDERS: Provider[] = ["apple", "google", "x"];

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const config = useConfig();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const data = config.data;
  // Only the ways in this server has switched on.
  const social = data?.supabase ? PROVIDERS.filter((p) => data.auth[p]) : [];
  const cash = data ? wholeDollars(data.paper.startingBalanceCents) : null;

  async function go(provider: Provider) {
    if (!data) return;
    setProblem(null);
    setBusy(provider);
    try {
      await signInWith(data, provider);
      // Signed in: the root layout moves on by itself.
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Sign-in didn't finish. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
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
              {data?.trading === "wallet"
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
            <Button variant="surface" size="lg" label="Try again" onPress={() => config.refetch()} />
          </>
        ) : config.isPending ? (
          <View style={styles.loading} accessibilityLabel="Loading ways to sign in" accessibilityRole="progressbar">
            <Skeleton height={52} round />
            <Skeleton height={52} round />
          </View>
        ) : (
          <>
            {social.map((provider) => (
              <Button
                key={provider}
                variant={provider === "apple" ? "ivory" : "surface"}
                size="lg"
                loading={busy === provider}
                disabled={!!busy && busy !== provider}
                onPress={() => go(provider)}
                icon={ICONS[provider]}
                label={LABELS[provider]}
              />
            ))}
            {social.length ? (
              <Pressable
                onPress={() => router.push("/email")}
                style={({ pressed }) => [styles.emailLink, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Text style={styles.emailLinkText}>Use email instead</Text>
              </Pressable>
            ) : (
              // Email is the only way in on this server: make it the button.
              <Button size="lg" label="Continue with email" onPress={() => router.push("/email")} />
            )}
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
const LABELS: Record<Provider, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
  x: "Continue with X",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: 24 },
  // A faint green light over the cards, as in the design.
  glow: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
    experimental_backgroundImage: "radial-gradient(70% 35% at 50% 28%, rgba(181, 230, 161, 0.09) 0%, rgba(181, 230, 161, 0) 100%)",
  },
  hero: { gap: 12 },
  // The wordmark file is 397×192.
  wordmark: { width: 54, height: 26 },
  headline: { fontFamily: font.semibold, fontSize: 30, lineHeight: 34, letterSpacing: -1.05, color: color.text },
  lede: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: color.muted },
  actions: { gap: 10, marginTop: 20 },
  loading: { gap: 10 },
  emailLink: { alignSelf: "center", height: 44, justifyContent: "center", paddingHorizontal: 12 },
  emailLinkText: { fontFamily: font.medium, fontSize: 14, color: color.text },
  legal: { fontFamily: font.regular, fontSize: 11, color: "#6f7975", textAlign: "center", marginTop: 4 },
});
