/**
 * Above a feed whose refresh failed but whose earlier posts are still on
 * screen: what went wrong, how old the posts are, and Retry.
 */
import { StyleSheet, Text, View } from "react-native";
import { ArrowClockwiseIcon } from "phosphor-react-native/src/icons/ArrowClockwise";
import { WifiSlashIcon } from "phosphor-react-native/src/icons/WifiSlash";
import { Button } from "~/components/button";
import { ago } from "~/lib/format";
import { color, font, space } from "~/theme/tokens";

export function FeedBanner({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  const age = ago(new Date(updatedAt).toISOString());
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <WifiSlashIcon size={20} weight="fill" color={color.neutral700} />
      <View style={styles.text}>
        <Text style={styles.title}>Couldn’t refresh the feed</Text>
        <Text style={styles.body}>
          {age === "now" ? "Showing posts from a moment ago." : `Showing posts from ${age} ago.`} Market prices on cards may be stale.
        </Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        label="Retry"
        onPress={onRetry}
        icon={<ArrowClockwiseIcon size={14} weight="fill" color={color.text} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: font.medium, fontSize: 13, color: color.text },
  body: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.neutral700 },
});
