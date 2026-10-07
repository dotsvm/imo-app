/**
 * Content that fades in and rises 6px on mount, after an optional delay.
 * Plain opacity and transform on a normal view, so it keeps its place in the
 * layout (layout-animation `entering` can lift it out). Still under reduced motion.
 */
import { type ReactNode, useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { motion } from "~/theme/tokens";

interface Props {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

export function Rise({ children, delay = 0, duration = motion.slow, style }: Props) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    shown.set(withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) })));
  }, [shown, delay, duration, reduced]);
  const animated = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * 6 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
