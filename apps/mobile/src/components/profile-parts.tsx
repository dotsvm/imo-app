/**
 * The pieces both profiles (yours and another trader's) are built from: the
 * three-column stat grid under the header, the record dots, and a call row
 * (a result dot, the market, a meta line, and the figures at the right).
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, font } from "~/theme/tokens";

const RULE = "rgba(255, 255, 255, 0.08)";

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function Stat({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.stat, !first && styles.statRule]}>
      <Text style={styles.statLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** A big figure, optionally green or coral, with a small muted tail ("of 86"). */
export function StatValue({ value, tone, tail }: { value: string; tone?: "gain" | "loss"; tail?: string }) {
  return (
    <Text style={[styles.statValue, tone === "gain" && { color: color.gain }, tone === "loss" && { color: color.neg }]} numberOfLines={1}>
      {value}
      {tail ? <Text style={styles.statTail}> {tail}</Text> : null}
    </Text>
  );
}

/** Green for right, coral for wrong; "—" when there's nothing yet. */
export function RecordDots({ results, label }: { results: boolean[]; label: string }) {
  return (
    <View
      style={styles.dots}
      accessible
      accessibilityLabel={results.length ? `${label}: ${results.map((r) => (r ? "right" : "wrong")).join(", ")}` : `${label}: none yet`}
    >
      {results.length ? (
        results.map((r, i) => <View key={i} style={[styles.dot, { backgroundColor: r ? color.gain : color.neg }]} />)
      ) : (
        <Text style={styles.statTail}>—</Text>
      )}
    </View>
  );
}

interface CallRowProps {
  /** The dot's color: right/gain green, wrong/loss coral; none hides it. */
  dot?: "good" | "bad" | null;
  title: string;
  meta: string;
  /** Top right: a figure or a side chip. */
  aside?: ReactNode;
  /** Bottom right: a verdict, a result or a move. */
  asideSub?: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}

export function CallRow({ dot, title, meta, aside, asideSub, onPress, accessibilityLabel }: CallRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.call, pressed && styles.callPressed]}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
    >
      {dot !== undefined ? (
        <View style={styles.callDotSlot}>
          {dot ? <View style={[styles.callDot, { backgroundColor: dot === "good" ? color.gain : color.neg }]} /> : null}
        </View>
      ) : null}
      <View style={styles.callMain}>
        <Text style={styles.callTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.small} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {aside || asideSub ? (
        <View style={styles.callAside}>
          {aside}
          {asideSub}
        </View>
      ) : null}
    </Pressable>
  );
}

/** A figure in a call row's right column (14px, tabular). */
export function Figure({ children, tone }: { children: ReactNode; tone?: "gain" | "loss" | "neutral" }) {
  return (
    <Text style={[styles.figure, tone === "gain" && { color: color.gain }, tone === "loss" && { color: color.neg }]}>{children}</Text>
  );
}

/** A call row's small right-hand line (11px): a verdict, a result, a move. */
export function Sub({ children, tone }: { children: ReactNode; tone?: "gain" | "loss" | "neutral" }) {
  return (
    <Text
      style={[
        styles.sub,
        tone === "gain" && { color: color.gain },
        tone === "loss" && { color: color.neg },
        tone === "neutral" && { color: color.neutral800 },
      ]}
    >
      {children}
    </Text>
  );
}

/** "Yes 28¢" / "No 41¢" in its side's tint. */
export function SideChip({ outcome, label }: { outcome: "Yes" | "No"; label: string }) {
  const yes = outcome === "Yes";
  return (
    <View style={[styles.side, { backgroundColor: yes ? "rgba(111, 211, 143, 0.14)" : "rgba(236, 139, 120, 0.14)" }]}>
      <Text style={[styles.sideText, { color: yes ? color.gain : color.neg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", marginHorizontal: 20, marginTop: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: RULE },
  stat: { flex: 1, gap: 3, paddingVertical: 14 },
  statRule: { borderLeftWidth: 1, borderLeftColor: RULE, paddingLeft: 14 },
  statLabel: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  statValue: { fontFamily: font.medium, fontSize: 20, lineHeight: 24, color: color.text, fontVariant: ["tabular-nums"] },
  statTail: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  dots: { flexDirection: "row", gap: 4, height: 24, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  call: { flexDirection: "row", alignItems: "center", columnGap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  callPressed: { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  callDotSlot: { width: 10, alignItems: "center" },
  callDot: { width: 8, height: 8, borderRadius: 4 },
  callMain: { flex: 1, gap: 3, minWidth: 0 },
  callTitle: { fontFamily: font.regular, fontSize: 14, lineHeight: 19, color: color.text },
  small: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  callAside: { alignItems: "flex-end", gap: 3 },
  figure: { fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: color.text, fontVariant: ["tabular-nums"] },
  sub: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  side: { height: 24, paddingHorizontal: 9, borderRadius: 999, justifyContent: "center" },
  sideText: { fontFamily: font.semibold, fontSize: 11, fontVariant: ["tabular-nums"] },
});
