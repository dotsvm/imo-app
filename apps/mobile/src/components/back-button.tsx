/**
 * Back and Fade on a post. Back is the primary key with the curved arrow,
 * side and price: `sm` (38 tall) on feed cards, `md` (48 tall) in a post's
 * bottom bar. Where Back and Fade show together they're a matched pair of
 * side-tinted pills: Back wears the author's side, Fade the other (Yes
 * green, No coral).
 */
import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { ArrowBendRightUpIcon } from "phosphor-react-native/src/icons/ArrowBendRightUp";
import { color, font, radius } from "~/theme/tokens";
import { Button, PRIMARY_INK } from "./button";

type Side = "Yes" | "No";

interface Props {
  outcome: Side;
  price: string;
  onPress: () => void;
  size?: "sm" | "md";
  /** `side`: tinted in the outcome's color, to pair with Fade. */
  tone?: "primary" | "side";
}

export function BackButton({ outcome, price, onPress, size = "md", tone = "primary" }: Props) {
  const sm = size === "sm";
  if (tone === "side")
    return (
      <SidePill side={outcome} onPress={onPress} label={`Back ${outcome} at ${price}`} style={styles.md}>
        <ArrowBendRightUpIcon size={16} weight="bold" color={ink(outcome)} />
        <Text style={[styles.label, { color: ink(outcome) }]}>Back {outcome}</Text>
        <View style={[styles.dot, { backgroundColor: ink(outcome), opacity: 0.45 }]} />
        <Text style={[styles.price, { color: ink(outcome) }]}>{price}</Text>
      </SidePill>
    );
  return (
    <Button
      size={sm ? "sm" : "md"}
      style={sm ? styles.sm : styles.md}
      onPress={onPress}
      accessibilityLabel={`Back ${outcome} at ${price}`}
      icon={<ArrowBendRightUpIcon size={sm ? 14 : 16} weight="bold" color={PRIMARY_INK} />}
      label={`Back ${outcome}`}
    >
      <View style={styles.dot} />
      <Text style={[styles.price, sm && styles.priceSm]}>{price}</Text>
    </Button>
  );
}

/** Fade: take the other side, as a pill tinted in that side's color. */
export function FadeButton({ side, price, onPress }: { side: Side; price: string; onPress: () => void }) {
  return (
    <SidePill side={side} onPress={onPress} label={`Fade, buy ${side} at ${price}`} style={styles.fade}>
      <Text style={[styles.label, { color: ink(side) }]}>Fade</Text>
    </SidePill>
  );
}

const ink = (side: Side) => (side === "Yes" ? color.pos : color.neg);

function SidePill({
  side,
  onPress,
  label,
  style,
  children,
}: {
  side: Side;
  onPress: () => void;
  label: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const yes = side === "Yes";
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        style,
        { backgroundColor: yes ? color.pos200 : color.neg200, borderColor: yes ? color.posLine : color.negLine },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sm: { height: 38, paddingHorizontal: 14, gap: 7 },
  md: { height: 48, paddingHorizontal: 22, gap: 7 },
  fade: { height: 48, paddingHorizontal: 18 },
  pill: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1 },
  pressed: { transform: [{ translateY: 1 }], opacity: 0.85 },
  label: { fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.1 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(11, 33, 20, 0.45)" },
  price: { fontFamily: font.semibold, fontSize: 15, color: PRIMARY_INK, fontVariant: ["tabular-nums"] },
  priceSm: { fontSize: 13 },
});
