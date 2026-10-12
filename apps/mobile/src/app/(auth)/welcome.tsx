/**
 * The way in: imo's name and promise, its mark among a few things happening
 * inside, then the ways to sign in this server has switched on — Apple,
 * Google, X (each only when it's on) — with email under "More options".
 * No wallet sign-in: every account gets its wallet itself.
 */
import { Image } from "expo-image";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { AppleLogoIcon } from "phosphor-react-native/src/icons/AppleLogo";
import { XLogoIcon } from "phosphor-react-native/src/icons/XLogo";
import { Button } from "~/components/button";
import { Rise } from "~/components/rise";
import { Skeleton } from "~/components/skeleton";
import { type Provider, signInWith, useConfig } from "~/features/auth/auth";
import { Problem } from "~/features/auth/parts";
import { WelcomeBackdrop, WelcomeStage } from "~/features/auth/welcome-art";
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

  async function go(provider: Provider) {
    if (!data) return;
    setProblem(null);
    setBusy(provider);
    try {
      await signInWith(data, provider);
      // Signed in: the root layout moves on by itself.
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Sign-in didn't finish. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) },
      ]}
    >
      <WelcomeBackdrop />
      <View style={styles.hero}>
        <Rise>
          <Image
            source={require("~/assets/welcome/wordmark.png")}
            style={styles.wordmark}
            contentFit="contain"
            accessibilityLabel="imo"
          />
        </Rise>
        <Rise delay={60}>
          <Text style={styles.headline} accessibilityRole="header">
            {"where your calls\nkeep the score"}
          </Text>
        </Rise>
      </View>

      <Rise delay={120} style={styles.stage}>
        <WelcomeStage />
      </Rise>

      <View style={styles.actions}>
        {config.isError ? (
          <>
            <Problem message="Can't reach imo. Check your connection." />
            <Button
              variant="ivory"
              size="xl"
              label="Try again"
              labelStyle={styles.buttonLabel}
              onPress={() => config.refetch()}
            />
          </>
        ) : config.isPending ? (
          <View
            style={styles.loading}
            accessibilityLabel="Loading ways to sign in"
            accessibilityRole="progressbar"
          >
            <Skeleton height={56} round />
            <Skeleton height={56} round />
          </View>
        ) : (
          <>
            {social.map((provider) => (
              <Button
                key={provider}
                variant={provider === "apple" ? "ivory" : "glass"}
                size="xl"
                loading={busy === provider}
                disabled={!!busy && busy !== provider}
                onPress={() => go(provider)}
                icon={ICONS[provider]}
                label={LABELS[provider]}
                labelStyle={styles.buttonLabel}
              />
            ))}
            {social.length ? (
              <Pressable
                onPress={() => router.push("/email")}
                style={({ pressed }) => [
                  styles.more,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.moreText}>More options</Text>
              </Pressable>
            ) : (
              // Email is the only way in on this server: make it the button.
              <Button
                variant="ivory"
                size="xl"
                label="Continue with email"
                labelStyle={styles.buttonLabel}
                onPress={() => router.push("/email")}
              />
            )}
            <Problem message={problem} />
          </>
        )}
        <Text style={styles.legal}>
          By signing up, you agree to our{"\n"}
          <Text style={styles.legalLink}>Terms of Service</Text> and{" "}
          <Text style={styles.legalLink}>Privacy Policy</Text>.
        </Text>
      </View>
    </View>
  );
}

/** Google's four-color G. */
function GoogleG() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

const ICONS: Record<Provider, ReactNode> = {
  apple: <AppleLogoIcon size={20} weight="fill" color="#0c100e" />,
  google: <GoogleG />,
  x: <XLogoIcon size={16} weight="bold" color={color.text} />,
};
const LABELS: Record<Provider, string> = {
  apple: "Sign in with Apple",
  google: "Sign in with Google",
  x: "Sign in with X",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  hero: {
    paddingTop: 48,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  // The wordmark file is 603×268.
  wordmark: { width: 144, height: 64 },
  headline: {
    fontFamily: font.medium,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.65,
    color: "#9aa39f",
    textAlign: "center",
  },
  stage: { flex: 1 },
  actions: { gap: 12, paddingHorizontal: 20, paddingBottom: 18 },
  loading: { gap: 12 },
  buttonLabel: { fontFamily: font.semibold, fontSize: 16 },
  more: {
    alignSelf: "center",
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  moreText: { fontFamily: font.medium, fontSize: 14, color: "#c9cfcb" },
  legal: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: color.muted,
    textAlign: "center",
  },
  legalLink: { color: "#c9cfcb" },
});
