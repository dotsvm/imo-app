/**
 * Text tabs with a green bar under the current one, scrolling sideways when
 * they don't fit. The bar slides to the tab you pick.
 */
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { type LayoutRectangle, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from "react-native-reanimated";
import { color, font, space } from "~/theme/tokens";

interface Props<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

export function UnderlineTabs<T extends string>({ options, value, onChange }: Props<T>) {
  const reduced = useReducedMotion();
  const [frames, setFrames] = useState<Record<string, LayoutRectangle>>({});
  const frame = frames[value];
  const bar = useAnimatedStyle(() => {
    if (!frame) return { opacity: 0 };
    const to = { transform: [{ translateX: frame.x }], width: frame.width, opacity: 1 };
    if (reduced) return to;
    return {
      opacity: 1,
      width: withSpring(frame.width, { damping: 22, stiffness: 260 }),
      transform: [{ translateX: withSpring(frame.x, { damping: 22, stiffness: 260 }) }],
    };
  });

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
              onLayout={(e) => {
                const layout = e.nativeEvent.layout;
                setFrames((f) => (f[o.id]?.x === layout.x && f[o.id]?.width === layout.width ? f : { ...f, [o.id]: layout }));
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
        <Animated.View style={[styles.bar, bar]} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider, marginTop: space[5] },
  row: { paddingHorizontal: space[4], gap: space[6] },
  tab: { paddingTop: 6, paddingBottom: 14 },
  label: { fontFamily: font.medium, fontSize: 17, color: color.neutral600 },
  labelOn: { color: color.text, fontFamily: font.semibold },
  bar: { position: "absolute", left: 0, bottom: 0, height: 3, borderRadius: 2, backgroundColor: color.pos },
});
