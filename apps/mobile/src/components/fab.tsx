/** The round green + that starts a new take, floating above the tab bar. */
import { Pressable, StyleSheet } from "react-native";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { PRIMARY_INK } from "./button";

export function Fab({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Share your take"
      hitSlop={6}
      style={({ pressed }) => [styles.fab, { bottom }, pressed ? styles.pressed : styles.rest]}
    >
      <PlusIcon size={26} weight="bold" color={PRIMARY_INK} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    experimental_backgroundImage: "linear-gradient(180deg, #c3edb1, #a7dd92)",
  },
  rest: {
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.55)", inset: true },
      { offsetX: 0, offsetY: -3, blurRadius: 8, color: "rgba(20, 60, 30, 0.22)", inset: true },
      { offsetX: 0, offsetY: 14, blurRadius: 30, spreadDistance: -10, color: "rgba(0, 0, 0, 0.7)" },
    ],
  },
  pressed: {
    transform: [{ translateY: 2 }, { scale: 0.97 }],
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.4)", inset: true },
      { offsetX: 0, offsetY: -1, blurRadius: 3, color: "rgba(20, 60, 30, 0.3)", inset: true },
      { offsetX: 0, offsetY: 4, blurRadius: 10, spreadDistance: -4, color: "rgba(0, 0, 0, 0.6)" },
    ],
  },
});
