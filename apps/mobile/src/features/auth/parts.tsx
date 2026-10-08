/** The pieces every sign-in and onboarding screen is built from. */
import { router } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Rise } from "~/components/rise";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { color, font, motion, radius, space, text } from "~/theme/tokens";

/** A full screen: safe areas, side gutters, and a footer that rides above the keyboard. */
export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top + 2 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>{children}</View>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

export function BackChevron({ onPress = () => router.back() }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [styles.chevron, pressed && styles.chevronPressed]}
    >
      <CaretLeftIcon size={20} weight="bold" color={color.text} />
    </Pressable>
  );
}

/** Onboarding's steps as bars, with Skip at the end. */
export function Progress({ step, of, onSkip }: { step: number; of: number; onSkip?: () => void }) {
  return (
    <View style={styles.progress}>
      <View style={styles.bars} accessible accessibilityLabel={`Step ${step} of ${of}`}>
        {Array.from({ length: of }, (_, i) => (
          <View key={i} style={[styles.bar, i < step && styles.barOn]} />
        ))}
      </View>
      {onSkip ? (
        <Pressable onPress={onSkip} hitSlop={12} accessibilityRole="button" style={styles.skipHit}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The screen's question. `after`: what sits above it — a back chevron (16 below) or the progress bars (28 below). */
export function Title({ children, after = "back" }: { children: ReactNode; after?: "back" | "progress" }) {
  return (
    <Text style={[styles.title, after === "progress" && styles.titleAfterProgress]} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** The line under a title: 15px on sign-in, `sm` (14px, a touch lighter) in onboarding. */
export function Lede({ children, size = "md" }: { children: ReactNode; size?: "md" | "sm" }) {
  return <Text style={[styles.lede, size === "sm" && styles.ledeSm]}>{children}</Text>;
}

/** A problem, said once, where it happened. Fades in. */
export function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Rise key={message} duration={motion.base}>
      <Text style={styles.problem} accessibilityLiveRegion="polite" accessibilityRole="alert">
        {message}
      </Text>
    </Rise>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, paddingHorizontal: space[5] },
  footer: { paddingHorizontal: space[5], paddingTop: space[3], gap: 6 },
  chevron: { width: 44, height: 44, marginLeft: -16, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  chevronPressed: { backgroundColor: "rgba(255, 255, 255, 0.06)" },
  progress: { flexDirection: "row", alignItems: "center", paddingTop: 14 },
  bars: { flex: 1, flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.1)" },
  barOn: { backgroundColor: color.pos },
  skipHit: { marginLeft: 10 },
  skip: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  title: { fontFamily: font.semibold, fontSize: 30, lineHeight: 33, letterSpacing: -1.05, color: color.text, marginTop: 16 },
  titleAfterProgress: { marginTop: 28 },
  lede: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.muted, marginTop: 8 },
  ledeSm: { fontSize: 14, lineHeight: 20, color: "#a7afab", marginTop: 10 },
  problem: { fontFamily: font.regular, fontSize: text.ui, lineHeight: 18, color: color.neg, marginTop: space[3] },
});
