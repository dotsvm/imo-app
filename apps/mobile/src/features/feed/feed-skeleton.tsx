/** The feed while it loads: post-shaped placeholders in the cards' own layout. */
import { StyleSheet, View } from "react-native";
import { Skeleton } from "~/components/skeleton";
import { space } from "~/theme/tokens";

export function FeedSkeleton() {
  return (
    <View accessibilityLabel="Loading the feed" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <Skeleton width={40} height={40} round />
          <View style={styles.main}>
            <Skeleton width="40%" height={13} style={styles.name} />
            <Skeleton width="90%" height={13} />
            <Skeleton width="70%" height={13} />
            <Skeleton height={52} style={styles.market} />
            <View style={styles.actions}>
              <Skeleton width={110} height={12} />
              <Skeleton width={120} height={38} round />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: space[4],
    paddingTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  main: { flex: 1, gap: 8 },
  name: { marginTop: 2 },
  market: { borderRadius: 16, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
});
