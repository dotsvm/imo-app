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
  /** No side padding: the row sits in a container that already has it. */
  flush?: boolean;
}

/** The day's move only means something with a history behind it (most-seen markets get one). */
export const hasHistory = (m: MarketDTO) => m.series.length > 1;

export function MarketRow({ market: m, venue, onPress, variant = "list", flush }: Props) {
  const resolved = m.status === "resolved";
  const search = variant === "search";
  const up = m.change > 0;
  const down = m.change < 0;
  // Around the venue badge: what comes before it and after it. A volume the venue didn't report isn't shown.
  const before = search ? "" : `${m.category} ·`;
  const after = search
    ? resolved
      ? `· Resolved${m.resolution.outcome ? ` · ${m.resolution.outcome}` : ""}`
      : `· Closes ${longDate(m.closesAt)}`
    : m.volumeCents > 0
      ? `· ${compactUsd(m.volumeCents)}`
      : "";
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [search ? styles.searchRow : styles.row, flush && styles.flush, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}, ${venue}, Yes ${price(m.yesPrice)}`}
    >
      <View style={styles.text}>
        <Text style={search ? styles.searchTitle : styles.title} numberOfLines={2}>
          {m.title}
        </Text>
        <View style={styles.metaRow}>
          {before ? <Text style={styles.meta}>{before}</Text> : null}
          <VenueBadge venueId={m.venueId} size={12} textStyle={styles.meta} />
          {after ? (
            <Text style={[styles.meta, styles.metaTail]} numberOfLines={1}>
              {after}
            </Text>
          ) : null}
        </View>
      </View>
      {search ? (
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
          {hasHistory(m) ? (
            <Text style={[styles.change, { color: up ? color.pos : down ? color.neg : color.neutral700 }]}>
              {up ? "▲ " : down ? "▼ " : ""}
              {Math.abs(m.change).toFixed(1).replace(/\.0$/, "")}¢
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[4],
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: space[4], paddingVertical: 11 },
  flush: { paddingHorizontal: 0 },
  pressed: { backgroundColor: color.neutral100 },
  text: { flex: 1, gap: 3 },
  // A list row reads one step up from the board's 13 (posts read larger on a phone).
  title: { fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: color.text },
  searchTitle: { fontFamily: font.regular, fontSize: text.body, lineHeight: 19, color: color.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  metaTail: { flexShrink: 1 },
  figure: { width: 56, alignSelf: "stretch", alignItems: "flex-end", justifyContent: "space-between", gap: 2 },
  price: { fontFamily: font.medium, fontSize: 16, lineHeight: 20, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.medium, fontSize: 11, fontVariant: ["tabular-nums"] },
  chip: { height: 30, paddingHorizontal: 11, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  chipText: { fontFamily: font.medium, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  state: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
});
