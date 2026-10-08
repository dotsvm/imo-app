/**
 * A pushed screen's header: a round back button, the page's name, and an
 * optional action at the right ("Mark all read"). Sits under the status bar.
 */
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { color, font, radius } from "~/theme/tokens";

interface Props {
  title: string;
  /** Beside the title, at the right edge. */
  right?: ReactNode;
  onBack?: () => void;
  /** Title size: 22 on most screens, 26 for a page-like screen (Top traders). */
  size?: 22 | 26;
  style?: StyleProp<ViewStyle>;
}

export function ScreenHeader({ title, right, onBack = () => router.back(), size = 22, style }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 2 }, style]}>
      <BackCircle onPress={onBack} />
      <Text
        style={[styles.title, size === 26 && styles.titleLg]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

/** The 40pt round back button on its own (profile headers). */
export function BackCircle({ onPress = () => router.back() }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <CaretLeftIcon size={20} weight="bold" color={color.text} />
    </Pressable>
  );
}

/** A 40pt round icon button for header tools (share, more, settings). */
export function HeaderIcon({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 16, paddingBottom: 12, backgroundColor: color.bg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: "rgba(255, 255, 255, 0.06)" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 22, letterSpacing: -0.44, color: color.text },
  titleLg: { fontSize: 26, letterSpacing: -0.52 },
});
