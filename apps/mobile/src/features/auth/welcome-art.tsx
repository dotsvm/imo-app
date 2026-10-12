/**
 * The welcome screen's art, as in the design: a dark green wash with a
 * grayscale pitch photo fading through it, soft green haze, film grain, and
 * imo's mark in a lit tile with four pills of what happens inside drifting
 * around it. Pure decoration: hidden from screen readers.
 */
import { Image } from "expo-image";
import { type ReactNode, useEffect } from "react";
import {
  Image as RNImage,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { color, font } from "~/theme/tokens";

// The design's frame: everything below is placed on a 390×844 screen and scaled to this one.
const FRAME = { width: 390, height: 844 };

// The pills' cluster around the tile: tall enough that the top and bottom
// pills clear the 124pt tile, wide enough for two pills side by side.
const CLUSTER = { width: 340, height: 250 };

// Soft haze, as [left, top, width, height, strength] on the design's frame.
const HAZE = [
  [-90, 150, 300, 120, 0.1],
  [170, 118, 320, 130, 0.09],
  [40, 210, 260, 90, 0.07],
  [-120, 520, 360, 150, 0.1],
  [150, 560, 340, 140, 0.11],
  [-40, 640, 470, 170, 0.13],
  [30, 730, 420, 160, 0.16],
] as const;

/** Everything behind the content: wash, photo, haze and grain. */
export function WelcomeBackdrop() {
  const { width, height } = useWindowDimensions();
  const sx = width / FRAME.width;
  const sy = height / FRAME.height;
  return (
    <View
      style={styles.backdrop}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.photo, { bottom: 120 * sy, height: 380 * sy }]}>
        <Image
          source={require("~/assets/welcome/backdrop.jpg")}
          style={styles.photoImage}
          contentFit="cover"
        />
        {/* Fades the photo into the wash above and below it. */}
        <View style={styles.photoFade} />
      </View>
      <View style={styles.crown} />
      {HAZE.map(([left, top, w, h, a], i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: left * sx,
            top: top * sy,
            width: w * sx,
            height: h * sy,
            experimental_backgroundImage: `radial-gradient(closest-side, rgba(214, 236, 206, ${a}) 0%, rgba(181, 230, 161, ${(a * 0.35).toFixed(3)}) 50%, rgba(181, 230, 161, 0) 100%)`,
          }}
        />
      ))}
      <View style={styles.floor} />
      <RNImage
        source={require("~/assets/welcome/grain.png")}
        resizeMode="repeat"
        style={styles.grain}
      />
    </View>
  );
}

/** imo's mark in its lit tile, with the four pills floating close around it. Fills the room it's given. */
export function WelcomeStage() {
  const { width } = useWindowDimensions();
  return (
    <View
      style={styles.stage}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.halo} />
      {/* The pills hug the tile: a cluster just wider than they need, centered on it. */}
      <View
        style={[styles.cluster, { width: Math.min(CLUSTER.width, width - 24) }]}
      >
        <Pill place={{ left: 0, top: 0 }} rotate="-6deg" phase={0}>
          <Image
            source={require("~/assets/welcome/mira.png")}
            style={styles.face}
          />
          <Text style={styles.pillText}>
            Mira called{" "}
            <Text style={[styles.strong, { color: color.pos }]}>Yes 28¢</Text>
          </Text>
        </Pill>
        <Pill place={{ right: 0, top: 24 }} rotate="5deg" phase={1}>
          <Image
            source={require("~/assets/welcome/kalshi.png")}
            style={[styles.face, styles.venue]}
          />
          <Text style={styles.pillText}>Fed holds rates</Text>
          <Text style={[styles.pillText, styles.strong, { color: color.pos }]}>
            62%
          </Text>
        </Pill>
        <Pill place={{ left: 8, bottom: 26 }} rotate="4deg" phase={2}>
          <Image
            source={require("~/assets/welcome/dayo.png")}
            style={styles.face}
          />
          <Text style={styles.pillText}>
            Dayo won{" "}
            <Text style={[styles.strong, { color: color.gain }]}>+$420</Text>
          </Text>
        </Pill>
        <Pill place={{ right: 0, bottom: 0 }} rotate="-4deg" phase={3}>
          <View>
            <Image
              source={require("~/assets/welcome/hoops.jpg")}
              style={styles.face}
            />
            <View style={styles.live} />
          </View>
          <Text style={styles.pillText}>Hoops Desk · 112 live</Text>
        </Pill>
        <View style={styles.tile}>
          <Image
            source={require("~/assets/brand/mark.png")}
            style={styles.mark}
            contentFit="contain"
          />
        </View>
      </View>
    </View>
  );
}

/** A pill that drifts up and down, each on its own beat. Still under reduced motion. */
function Pill({
  place,
  rotate,
  phase,
  children,
}: {
  place: Pick<ViewStyle, "left" | "right" | "top" | "bottom">;
  rotate: string;
  phase: number;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const drift = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    drift.set(
      withDelay(
        phase * 450,
        withRepeat(
          withTiming(1, {
            duration: 2600 + phase * 350,
            easing: Easing.inOut(Easing.sin),
          }),
          -1,
          true,
        ),
      ),
    );
  }, [drift, phase, reduced]);
  const float = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * drift.get() }],
  }));
  return (
    <Animated.View style={[styles.place, place, float]}>
      <View style={[styles.pill, { transform: [{ rotate }] }]}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
    overflow: "hidden",
    experimental_backgroundImage:
      "linear-gradient(180deg, #070a09 0%, #0a100d 55%, #13201a 100%)",
  },
  photo: { position: "absolute", left: 0, right: 0, opacity: 0.32 },
  photoImage: { width: "100%", height: "100%" },
  // The wash's own colors where the photo starts and ends, so its edges vanish.
  photoFade: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage:
      "linear-gradient(180deg, #090e0b 0%, rgba(9, 14, 11, 0) 45%, rgba(16, 27, 22, 0) 70%, #101b16 100%)",
  },
  crown: {
    position: "absolute",
    left: "-20%",
    right: "-20%",
    top: -120,
    height: 420,
    experimental_backgroundImage:
      "radial-gradient(60% 55% at 50% 0%, rgba(181, 230, 161, 0.13) 0%, rgba(181, 230, 161, 0) 70%)",
  },
  floor: {
    position: "absolute",
    left: "-10%",
    right: "-10%",
    bottom: -60,
    height: 300,
    experimental_backgroundImage:
      "radial-gradient(70% 60% at 50% 100%, rgba(181, 230, 161, 0.18) 0%, rgba(181, 230, 161, 0) 70%)",
  },
  grain: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
    opacity: 0.08,
    mixBlendMode: "overlay",
  },
  stage: {
    flex: 1,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  cluster: {
    height: CLUSTER.height,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 340,
    height: 340,
    borderRadius: 170,
    experimental_backgroundImage:
      "radial-gradient(circle, rgba(181, 230, 161, 0.16) 0%, rgba(181, 230, 161, 0) 65%)",
  },
  tile: {
    width: 124,
    height: 124,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    experimental_backgroundImage: "linear-gradient(160deg, #1b2420, #0b100e)",
    boxShadow: [
      "inset 0 1px 0 rgba(255, 255, 255, 0.14)",
      "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
      "0 0 0 6px rgba(255, 255, 255, 0.025)",
      "0 30px 60px -18px rgba(0, 0, 0, 0.9)",
      "0 0 60px -10px rgba(181, 230, 161, 0.25)",
    ].join(", "),
  },
  // The mark file is square, with its own padding.
  mark: { width: 84, height: 84 },
  place: { position: "absolute", zIndex: 2 },
  pill: {
    height: 38,
    paddingLeft: 6,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "rgba(18, 24, 21, 0.92)",
    boxShadow:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 14px 30px -12px rgba(0, 0, 0, 0.8)",
  },
  face: { width: 26, height: 26, borderRadius: 13 },
  venue: { backgroundColor: "#fff" },
  live: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ec8b78",
    boxShadow: "0 0 0 2px #121815",
  },
  pillText: { fontFamily: font.medium, fontSize: 12, color: color.text },
  strong: { fontFamily: font.semibold },
});
