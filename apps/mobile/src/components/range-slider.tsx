/**
 * Two thumbs on a track, for a range of cents (0–100 in steps of 5).
 * Drag either thumb; they never cross. Each thumb is adjustable with the
 * screen reader's increment and decrement gestures too.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { color } from "~/theme/tokens";

interface Props {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  step?: number;
  gap?: number;
}

const THUMB = 26;

export function RangeSlider({ min, max, onChange, step = 5, gap = 5 }: Props) {
  const [width, setWidth] = useState(0);
  const track = Math.max(1, width - THUMB);
  const toX = (v: number) => (v / 100) * track;
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)) / step) * step;

  const setMin = (v: number) => onChange(Math.min(clamp(v), max - gap), max);
  const setMax = (v: number) => onChange(min, Math.max(clamp(v), min + gap));

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.rail} />
      {width ? (
        <>
          <View style={[styles.fill, { left: toX(min) + THUMB / 2, width: toX(max) - toX(min) }]} />
          <Thumb value={min} track={track} step={step} label="Lowest Yes price" onChange={setMin} />
          <Thumb value={max} track={track} step={step} label="Highest Yes price" onChange={setMax} />
        </>
      ) : null}
    </View>
  );
}

interface ThumbProps {
  value: number;
  track: number;
  step: number;
  label: string;
  onChange: (value: number) => void;
}

function Thumb({ value, track, step, label, onChange }: ThumbProps) {
  // Where the drag began, in cents; shared with the gesture on the UI thread.
  const start = useSharedValue(0);
  const pan = Gesture.Pan()
    .hitSlop({ top: 14, bottom: 14, left: 14, right: 14 })
    .onBegin(() => {
      start.set(value);
    })
    .onUpdate((e) => {
      scheduleOnRN(onChange, start.get() + (e.translationX / track) * 100);
    });
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.thumb, { left: (value / 100) * track }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: `${value}¢` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(value + (e.nativeEvent.actionName === "increment" ? step : -step))}
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { height: THUMB + 8, justifyContent: "center" },
  rail: { position: "absolute", left: THUMB / 2, right: THUMB / 2, height: 3, borderRadius: 2, backgroundColor: color.neutral400 },
  fill: { position: "absolute", height: 3, borderRadius: 2, backgroundColor: color.pos },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: "#f3f1ea",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(0, 0, 0, 0.15)",
  },
});
