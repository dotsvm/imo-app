/**
 * A row of text tabs with an underline that slides to the selected one
 * (jumps under reduced motion). Used for the feed switcher.
 */
import { useState } from "react";
import { type LayoutRectangle, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { color, font, motion, space, text } from "~/theme/tokens";

interface Props<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

export function SegmentedTabs<T extends string>({ options, value, onChange }: Props<T>) {
  const reduced = useReducedMotion();
  const [layouts, setLayouts] = useState<Partial<Record<T, LayoutRectangle>>>({});
  const current = layouts[value];
  const indicator = useAnimatedStyle(() => {
    if (!current) return { opacity: 0 };
    const to = (v: number) => (reduced ? v : withTiming(v, { duration: motion.base }));
    return { opacity: 1, width: to(current.width), transform: [{ translateX: to(current.x) }] };
  }, [current, reduced]);

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            onLayout={(e) => {
              const layout = e.nativeEvent.layout;
              setLayouts((prev) => ({ ...prev, [o.id]: layout }));
            }}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.selected]}>{o.label}</Text>
          </Pressable>
        );
      })}
      <Animated.View style={[styles.indicator, indicator]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  tab: { paddingHorizontal: space[3], paddingVertical: space[3] },
  label: { fontFamily: font.medium, fontSize: text.body + 1, color: color.neutral600 },
  selected: { color: color.text },
  indicator: { position: "absolute", left: 0, bottom: -StyleSheet.hairlineWidth, height: 2, borderRadius: 1, backgroundColor: color.text },
});
