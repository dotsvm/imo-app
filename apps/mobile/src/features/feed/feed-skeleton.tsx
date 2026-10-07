/** The feed while it loads: post-shaped placeholders in the cards' own layout. */
import { StyleSheet, View } from "react-native";
import { Skeleton } from "~/components/skeleton";
import { color, radius, space } from "~/theme/tokens";

export function FeedSkeleton() {
  return (
    <View accessibilityLabel="Loading the feed" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <View style={styles.head}>
            <Skeleton width={36} height={36} round />
            <View style={styles.who}>
              <Skeleton width={120} height={13} />
              <Skeleton width={84} height={11} />
            </View>
          </View>
          <View style={styles.lines}>
            <Skeleton height={13} />
            <Skeleton height={13} />
            <Skeleton width="62%" height={13} />
          </View>
          <Skeleton height={56} style={{ borderRadius: radius.card }} />
          <View style={styles.actions}>
            <Skeleton width={120} height={14} />
            <Skeleton width={128} height={40} round />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[4],
    gap: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  who: { gap: 6 },
  lines: { gap: 8 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
