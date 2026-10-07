/**
 * The ticker strip under the feed tabs: top traders by 30-day P&L, gliding
 * left at a calm pace (as on the web: four seconds a trader). Two copies of
 * the line run back to back so the loop never shows a seam. A line narrower
 * than the screen sits still, as does everything under reduced motion.
 */
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLeaderboard } from "~/features/feed/use-records";
import { arrowUsd } from "~/lib/format";
import { color, font, space } from "~/theme/tokens";

const SECONDS_PER_TRADER = 4;
const SHOWN = 12;

export function Ticker() {
  const reduced = useReducedMotion();
  const board = useLeaderboard("30D", "pnl", SHOWN + 1);
  const leaders = (board.data?.items ?? []).filter((r) => !r.trader.isYou).slice(0, SHOWN);
  const [line, setLine] = useState(0);
  const [strip, setStrip] = useState(0);
  const loop = !reduced && line > strip && strip > 0;

  const x = useSharedValue(0);
  useEffect(() => {
    if (!loop) {
      cancelAnimation(x);
      x.set(0);
      return;
    }
    x.set(0);
    x.set(withRepeat(withTiming(-line, { duration: leaders.length * SECONDS_PER_TRADER * 1000, easing: Easing.linear }), -1));
    return () => cancelAnimation(x);
  }, [loop, line, leaders.length, x]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  if (!leaders.length) return <View style={styles.strip} />;

  const group = (copy: boolean) => (
    <View style={styles.group} onLayout={copy ? undefined : (e) => setLine(e.nativeEvent.layout.width)}>
      {leaders.map(({ trader, stats }) => (
        <View key={trader.id} style={styles.item}>
          <Text style={styles.handle}>@{trader.handle}</Text>
          <Text style={[styles.pnl, { color: stats.pnlCents < 0 ? color.neg : color.pos }]}>{arrowUsd(stats.pnlCents)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View
      style={styles.strip}
      onLayout={(e) => setStrip(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Top traders this month: ${leaders
        .slice(0, 3)
        .map((l) => `${l.trader.handle} ${arrowUsd(l.stats.pnlCents)}`)
        .join(", ")}`}
    >
      {loop ? (
        <Animated.View style={[styles.track, moving]}>
          {group(false)}
          {group(true)}
        </Animated.View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {group(false)}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  track: { flexDirection: "row" },
  group: { flexDirection: "row", paddingLeft: space[3] },
  item: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: space[5] },
  handle: { fontFamily: font.medium, fontSize: 14, color: color.text },
  pnl: { fontFamily: font.regular, fontSize: 14, fontVariant: ["tabular-nums"] },
});
