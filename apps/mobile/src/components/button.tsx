/**
 * imo's buttons: every one a pill. `primary` is the lit green key (gradient,
 * top highlight, inner shade, drop shadow) that sinks 2px when pressed;
 * `ivory` is the same key in white, for Apple; `outline` for other ways in; `quiet` for small actions.
 */
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { color, font, radius } from "~/theme/tokens";

export type ButtonVariant = "primary" | "ivory" | "outline" | "quiet";

interface Props {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  label?: string;
  icon?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const PRIMARY_INK = "#0b2114";

export function Button({
  variant = "primary",
  size = "md",
  label,
  icon,
  children,
  onPress,
  disabled,
  loading,
  style,
  accessibilityLabel,
}: Props) {
  const v = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        v.box,
        pressed && !inactive ? v.pressed : v.rest,
        inactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.ink} />
      ) : (
        <>
          {icon}
          {label ? <Text style={[styles.label, size === "lg" && styles.labelLg, size === "sm" && styles.labelSm, { color: v.ink }]}>{label}</Text> : null}
          {children}
        </>
      )}
    </Pressable>
  );
}

const GRADIENT = "linear-gradient(180deg, #c3edb1, #a7dd92)";

const VARIANTS: Record<
  ButtonVariant,
  { box: ViewStyle; rest?: ViewStyle; pressed?: ViewStyle; ink: string; text?: TextStyle }
> = {
  primary: {
    ink: PRIMARY_INK,
    box: {
      // The flat color shows where gradients don't draw (react-native-web).
      backgroundColor: "#b5e6a1",
      experimental_backgroundImage: GRADIENT,
    },
    rest: {
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.55)", inset: true },
        { offsetX: 0, offsetY: -2, blurRadius: 4, color: "rgba(20, 60, 30, 0.28)", inset: true },
        { offsetX: 0, offsetY: 6, blurRadius: 14, spreadDistance: -4, color: "rgba(0, 0, 0, 0.6)" },
      ],
    },
    pressed: {
      transform: [{ translateY: 2 }],
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.4)", inset: true },
        { offsetX: 0, offsetY: -1, blurRadius: 2, color: "rgba(20, 60, 30, 0.3)", inset: true },
        { offsetX: 0, offsetY: 2, blurRadius: 6, spreadDistance: -3, color: "rgba(0, 0, 0, 0.6)" },
      ],
    },
  },
  // The same lit key as primary, in white: a bright top edge, a soft warm
  // shade at the bottom, a drop shadow, and the 2px sink on press.
  ivory: {
    ink: "#0b0d0c",
    box: {
      backgroundColor: "#eceadf",
      experimental_backgroundImage: "linear-gradient(180deg, #ffffff, #e2dfd4)",
    },
    rest: {
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.9)", inset: true },
        { offsetX: 0, offsetY: -2, blurRadius: 4, color: "rgba(70, 62, 40, 0.2)", inset: true },
        { offsetX: 0, offsetY: 6, blurRadius: 14, spreadDistance: -4, color: "rgba(0, 0, 0, 0.6)" },
      ],
    },
    pressed: {
      transform: [{ translateY: 2 }],
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.7)", inset: true },
        { offsetX: 0, offsetY: -1, blurRadius: 2, color: "rgba(70, 62, 40, 0.24)", inset: true },
        { offsetX: 0, offsetY: 2, blurRadius: 6, spreadDistance: -3, color: "rgba(0, 0, 0, 0.6)" },
      ],
    },
  },
  outline: {
    ink: color.text,
    box: { backgroundColor: color.neutral100, borderWidth: 1, borderColor: color.neutral400 },
    rest: { boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.035)" },
    pressed: { backgroundColor: color.neutral300 },
  },
  quiet: {
    ink: color.text,
    box: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.neutral400 },
    pressed: { backgroundColor: color.neutral300 },
  },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
  },
  sm: { height: 34, paddingHorizontal: 14, gap: 6 },
  md: { height: 44, paddingHorizontal: 20 },
  lg: { height: 52, paddingHorizontal: 24 },
  inactive: { opacity: 0.45 },
  label: { fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.1 },
  labelLg: { fontSize: 16 },
  labelSm: { fontSize: 13 },
});
