/** A market in a list: question, where it's from (venue logos) and how big, its Yes price and the day's move. */
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MarketDTO } from "@imo/server/dto/api-types";
import { VenueBadge } from "~/components/venue-badge";
import { price } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

export const compactUsd = (cents: number) => {
  const d = cents / 100;
  if (d >= 1e9) return `$${(d / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (d >= 1e3) return `$${(d / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(d)}`;
};

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

interface Props {
  market: MarketDTO;
  venue: string;
  onPress?: () => void;
  /** "list": category · venue · volume, with the day's move. "search": venue · when it closes, price in a chip. */
  variant?: "list" | "search";
}

export function MarketRow({ market: m, venue, onPress, variant = "list" }: Props) {
  const resolved = m.status === "resolved";
  const up = m.change > 0;
  const down = m.change < 0;
  // Around the venue badge: what comes before it and after it.
  const before = variant === "search" ? "" : `${m.category} ·`;
  const after =
    variant === "search"
      ? resolved
        ? `· Resolved${m.resolution.outcome ? ` · ${m.resolution.outcome}` : ""}`
        : `· Closes ${longDate(m.closesAt)}`
      : `· ${compactUsd(m.volumeCents)}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}, ${venue}, Yes ${price(m.yesPrice)}`}
    >
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {m.title}
        </Text>
        <View style={styles.metaRow}>
          {before ? <Text style={styles.meta}>{before}</Text> : null}
          <VenueBadge venueId={m.venueId} />
          <Text style={[styles.meta, styles.metaTail]} numberOfLines={1}>
            {after}
          </Text>
        </View>
      </View>
      {variant === "search" ? (
        resolved || m.status === "closed" ? (
          <Text style={styles.state}>{resolved ? "Resolved" : "Awaiting result"}</Text>
        ) : (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{price(m.yesPrice)}</Text>
          </View>
        )
      ) : (
        <View style={styles.figure}>
          <Text style={styles.price}>{price(m.yesPrice)}</Text>
          <Text style={[styles.change, { color: up ? color.pos : down ? color.neg : color.neutral700 }]}>
            {up ? "▲ " : down ? "▼ " : ""}
            {Math.abs(m.change).toFixed(1).replace(/\.0$/, "")}¢
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  pressed: { backgroundColor: color.neutral100 },
  text: { flex: 1, gap: 5 },
  title: { fontFamily: font.medium, fontSize: text.post, lineHeight: 21, color: color.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  metaTail: { flexShrink: 1 },
  figure: { alignItems: "flex-end", gap: 4 },
  price: { fontFamily: font.semibold, fontSize: 18, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.medium, fontSize: 12, fontVariant: ["tabular-nums"] },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: color.neutral200 },
  chipText: { fontFamily: font.semibold, fontSize: text.body, color: color.text, fontVariant: ["tabular-nums"] },
  state: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
});
