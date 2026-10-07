/**
 * A market's Yes price over a range: one line with a soft green wash under
 * it, scaled to the range's own high and low so moves read clearly.
 */
import { useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { color } from "~/theme/tokens";

export function PriceChart({ points, height = 150 }: { points: number[]; height?: number }) {
  const [width, setWidth] = useState(0);
  const pad = 6;
  let line = "";
  let area = "";
  if (width && points.length > 1) {
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    const xy = points.map((p, i) => [
      (i / (points.length - 1)) * width,
      pad + (1 - (p - lo) / span) * (height - pad * 2),
    ]);
    line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)} ${y!.toFixed(1)}`).join(" ");
    area = `${line} L${width} ${height} L0 ${height} Z`;
  }
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityElementsHidden>
      {line ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.pos} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color.pos} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#wash)" />
          <Path d={line} stroke={color.pos} strokeWidth={1.75} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
