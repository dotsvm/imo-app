/**
 * Press and hold to confirm: a darker green fills the primary key left to
 * right; letting go early drains it. Placing an order takes intent, not a
 * stray tap. Screen readers activate it directly.
 */
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { font, radius } from "~/theme/tokens";
import { PRIMARY_INK } from "./button";

const HOLD_MS = 650;

interface Props {
  label: string;
  icon?: ReactNode;
  onComplete: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function HoldButton({ label, icon, onComplete, disabled, loading }: Props) {
  const progress = useSharedValue(0);
  const fill = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));
  const done = () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onComplete();
  };
  const inactive = disabled || loading;

  return (
    <Pressable
      disabled={inactive}
      onPressIn={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        progress.set(
          withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (finished) => {
            if (finished) scheduleOnRN(done);
          }),
        );
      }}
      onPressOut={() => {
        if (progress.get() < 1) progress.set(withTiming(0, { duration: 180 }));
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to confirm"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "activate" && !inactive && onComplete()}
      style={[styles.key, inactive && styles.inactive]}
    >
      <Animated.View style={[styles.fill, fill]} />
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={PRIMARY_INK} />
        ) : (
          <>
            {icon}
            <Text style={styles.label}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  key: {
    height: 54,
    borderRadius: radius.pill,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    experimental_backgroundImage: "linear-gradient(180deg, #c3edb1, #a7dd92)",
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.55)", inset: true },
      { offsetX: 0, offsetY: -2, blurRadius: 4, color: "rgba(20, 60, 30, 0.28)", inset: true },
      { offsetX: 0, offsetY: 6, blurRadius: 14, spreadDistance: -4, color: "rgba(0, 0, 0, 0.6)" },
    ],
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(60, 120, 60, 0.35)" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  label: { fontFamily: font.semibold, fontSize: 16, color: PRIMARY_INK },
  inactive: { opacity: 0.45 },
});
