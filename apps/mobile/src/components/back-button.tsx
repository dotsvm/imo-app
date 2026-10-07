/** The Back pill on a post: the primary key with the curved arrow, side and price. */
import { StyleSheet, Text, View } from "react-native";
import { ArrowBendRightUpIcon } from "phosphor-react-native/src/icons/ArrowBendRightUp";
import { font } from "~/theme/tokens";
import { Button, PRIMARY_INK } from "./button";

interface Props {
  outcome: "Yes" | "No";
  price: string;
  onPress: () => void;
}

export function BackButton({ outcome, price, onPress }: Props) {
  return (
    <Button
      onPress={onPress}
      accessibilityLabel={`Back ${outcome} at ${price}`}
      icon={<ArrowBendRightUpIcon size={16} weight="bold" color={PRIMARY_INK} />}
      label={`Back ${outcome}`}
    >
      <View style={styles.dot} />
      <Text style={styles.price}>{price}</Text>
    </Button>
  );
}

const styles = StyleSheet.create({
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(11, 33, 20, 0.45)" },
  price: { fontFamily: font.semibold, fontSize: 15, color: PRIMARY_INK, fontVariant: ["tabular-nums"] },
});
