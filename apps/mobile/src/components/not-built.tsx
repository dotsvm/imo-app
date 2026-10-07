/** A tab whose screen isn't built in the app yet. Says so plainly. */
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, space, text } from "~/theme/tokens";

export function NotBuilt({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[3] }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>This screen is next on the build list.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space[4], gap: space[2] },
  title: { fontFamily: font.display, fontSize: text.h1, color: color.text },
  body: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
});
