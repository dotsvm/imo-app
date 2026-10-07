/**
 * A placeholder block that breathes slowly while its content loads, in the
 * shape of what's coming. Still under reduced motion.
 */
import { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { color, radius } from "~/theme/tokens";

interface Props {
  width?: DimensionValue;
  height: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = "100%", height, round, style }: Props) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    opacity.set(withRepeat(withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [opacity, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: color.neutral200, borderRadius: round ? height / 2 : radius.chip },
        animated,
        style,
      ]}
    />
  );
}
