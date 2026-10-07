/**
 * A Pressable that gives under the finger: a quick 3% press-in, eased back
 * on release. Static when the system asks for reduced motion.
 */
import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { motion } from "~/theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** How far it sinks: 0.97 for buttons, 0.99 for whole cards. */
  pressedScale?: number;
}

export function PressableScale({ style, children, pressedScale = 0.97, onPressIn, onPressOut, ...rest }: Props) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduced) scale.set(withTiming(pressedScale, { duration: motion.fast }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) scale.set(withTiming(1, { duration: motion.base }));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
