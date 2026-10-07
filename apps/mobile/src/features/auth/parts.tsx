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
      style={[styles.screen, { paddingTop: insets.top + space[2] }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>{children}</View>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

export function BackChevron({ onPress = () => router.back() }: { onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.chevron}>
      <CaretLeftIcon size={22} weight="bold" color={color.text} />
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
        <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button">
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <Text style={styles.lede}>{children}</Text>;
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
  footer: { paddingHorizontal: space[5], paddingTop: space[3], gap: space[3] },
  chevron: { width: 40, height: 40, marginLeft: -10, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  progress: { flexDirection: "row", alignItems: "center", gap: space[4], height: 40 },
  bars: { flex: 1, flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.neutral400 },
  barOn: { backgroundColor: color.pos },
  skip: { fontFamily: font.medium, fontSize: text.body + 1, color: color.neutral700 },
  title: { fontFamily: font.medium, fontSize: 29, lineHeight: 35, letterSpacing: -0.9, color: color.text, marginTop: space[5] },
  lede: { fontFamily: font.regular, fontSize: 16, lineHeight: 22, color: color.neutral700, marginTop: space[3] },
  problem: { fontFamily: font.regular, fontSize: text.ui, lineHeight: 18, color: color.neg, marginTop: space[3] },
});
