/**
 * A row of pill tabs: the current one lit ivory, the rest on the card
 * surface. Used for a profile's lists, the leaderboard's periods and the
 * notification filters. Scrolls sideways when the pills don't fit.
 */
import * as Haptics from "expo-haptics";
import { Platform, Pressable, ScrollView, type StyleProp, StyleSheet, Text, type ViewStyle } from "react-native";
import { color, font, radius } from "~/theme/tokens";

interface Props<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** The row's padding (defaults to 20 at the sides). */
  style?: StyleProp<ViewStyle>;
}

export function ChipTabs<T extends string>({ options, value, onChange, style }: Props<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
      accessibilityRole="tablist"
      style={styles.scroll}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              if (on) return;
              if (Platform.OS !== "web") Haptics.selectionAsync();
              onChange(o.id);
            }}
            style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && styles.pressed]}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 20 },
  chip: { height: 32, paddingHorizontal: 13, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.card },
  chipOn: { backgroundColor: color.text },
  pressed: { backgroundColor: "#161d19" },
  label: { fontFamily: font.regular, fontSize: 13, color: color.neutral800 },
  labelOn: { fontFamily: font.medium, color: "#0c100e" },
});
