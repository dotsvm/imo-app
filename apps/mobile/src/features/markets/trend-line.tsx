/**
 * A quiet line of recent values, scaled to its own range, in a color the
 * caller picks (up green, down coral, flat grey). `wash` adds a soft fill
 * under it that fades to nothing.
 */
import { useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

interface Props {
  points: number[];
  height: number;
  stroke: string;
  strokeWidth?: number;
  /** Opacity of the fill at the top; none when omitted. */
  wash?: number;
  /** A fixed width (else it fills its parent). */
  width?: number;
}

export function TrendLine({ points, height, stroke, strokeWidth = 1.5, wash, width: fixed }: Props) {
  const [measured, setMeasured] = useState(0);
  const gradient = `wash${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const width = fixed ?? measured;
  const pad = Math.ceil(strokeWidth) + 1;
  let line = "";
  if (width && points.length > 1) {
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    line = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = pad + (1 - (p - lo) / span) * (height - pad * 2);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <View
      style={{ height, width: fixed }}
      onLayout={fixed ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {line ? (
        <Svg width={width} height={height}>
          {wash ? (
            <>
              <Defs>
                <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity={wash} />
                  <Stop offset="1" stopColor={stroke} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#${gradient})`} />
            </>
          ) : null}
          <Path d={line} stroke={stroke} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
