/** A market's recent price as one quiet line, scaled to its own range. */
import { useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color } from "~/theme/tokens";

export function Sparkline({ points, height = 64, strokeWidth = 1.75 }: { points: number[]; height?: number; strokeWidth?: number }) {
  const [width, setWidth] = useState(0);
  const pad = 3;
  let d = "";
  if (width && points.length > 1) {
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    d = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = pad + (1 - (p - lo) / span) * (height - pad * 2);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityElementsHidden>
      {d ? (
        <Svg width={width} height={height}>
          <Path d={d} stroke={color.pos} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
