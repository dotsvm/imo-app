/**
 * Discover's market filters: sort, venue, status and a Yes-price range, in a
 * bottom sheet. Changes stay a draft until "Show N markets" applies them; the
 * count is live from the API (to 100, then "100+").
 */
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import type { MarketPage } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { RangeSlider } from "~/components/range-slider";
import { useConfig } from "~/features/auth/auth";
import { api } from "~/lib/api";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";
import { VenueMark } from "~/components/venue-mark";

export interface Filters {
  sort: "trending" | "volume" | "closing" | "movers";
  venue: string;
  status: "open" | "soon" | "closed" | "resolved";
  min: number;
  max: number;
}

export const DEFAULT_FILTERS: Filters = { sort: "trending", venue: "All", status: "open", min: 0, max: 100 };

export const isDefault = (f: Filters) =>
  f.sort === DEFAULT_FILTERS.sort &&
  f.venue === "All" &&
  f.status === "open" &&
  f.min === 0 &&
  f.max === 100;

/** The /markets query for these filters (and a category). */
export const marketQuery = (f: Filters, category: string) => ({
  sort: f.sort,
  status: f.status,
  venue: f.venue === "All" ? undefined : f.venue,
  category: category === "All" ? undefined : category,
  min: f.min > 0 ? f.min : undefined,
  max: f.max < 100 ? f.max : undefined,
});

const SORTS: { id: Filters["sort"]; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "volume", label: "Volume" },
  { id: "closing", label: "Closing soon" },
  { id: "movers", label: "Biggest move" },
];
const STATUSES: { id: Filters["status"]; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "soon", label: "Closes in 7 days" },
  { id: "closed", label: "Awaiting result" },
  { id: "resolved", label: "Resolved" },
];

interface Props {
  open: boolean;
  value: Filters;
  category: string;
  onApply: (f: Filters) => void;
  onClose: () => void;
}

export function FilterSheet({ open, value, category, onApply, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const venues = useVenues();
  const config = useConfig().data;
  const [draft, setDraft] = useState(value);
  // Each opening starts from what's applied.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  const count = useQuery({
    queryKey: ["markets", "count", draft, category],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { ...marketQuery(draft, category), limit: 100 }, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const n = count.data ? (count.data.next ? "100+" : String(count.data.items.length)) : null;

  // Only venues whose markets the server shows (/config → venues), in its order.
  const shown = (config?.venues ?? [...venues.keys()]).filter((id) => venues.has(id));
  const venueOptions = [
    { id: "All", label: shown.length === 2 ? "Both" : "All", mark: null as null | { mark: string; color: string } },
    ...shown.map((id) => {
      const d = venues.get(id)!;
      return { id, label: d.name, mark: { mark: d.mark, color: d.color } };
    }),
  ];

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + space[2], 28) }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <Text style={styles.title}>Filter markets</Text>
          <Pressable
            onPress={() => setDraft(DEFAULT_FILTERS)}
            hitSlop={6}
            style={({ pressed }) => [styles.resetPill, pressed && styles.chipPressed]}
            accessibilityRole="button"
            accessibilityLabel="Reset filters"
          >
            <Text style={styles.reset}>Reset</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Group label="Sort by">
            {SORTS.map((o) => (
              <Chip key={o.id} label={o.label} on={draft.sort === o.id} onPress={() => set({ sort: o.id })} />
            ))}
          </Group>
          <Group label="Venue">
            {venueOptions.map((o) => (
              <Chip
                key={o.id}
                label={o.label}
                on={draft.venue === o.id}
                onPress={() => set({ venue: o.id })}
                lead={o.mark ? <VenueMark venueId={o.id} size={14} /> : null}
              />
            ))}
          </Group>
          <Group label="Status">
            {STATUSES.map((o) => (
              <Chip key={o.id} label={o.label} on={draft.status === o.id} onPress={() => set({ status: o.id })} />
            ))}
          </Group>

          <View style={styles.rangeHead}>
            <Text style={styles.groupLabel}>Yes price</Text>
            <Text style={styles.rangeValue}>
              {draft.min === 0 && draft.max === 100 ? "Any" : `${draft.min}¢ – ${draft.max}¢`}
            </Text>
          </View>
          <RangeSlider min={draft.min} max={draft.max} onChange={(min, max) => set({ min, max })} />
          <View style={styles.rangeLabels}>
            <Text style={styles.rangeLabel}>Long shots</Text>
            <Text style={styles.rangeLabel}>Coin flips</Text>
            <Text style={styles.rangeLabel}>Near certain</Text>
          </View>
        </ScrollView>

        <Button
          size="lg"
          label={n === null ? "Show markets" : n === "0" ? "No markets match" : `Show ${n} market${n === "1" ? "" : "s"}`}
          disabled={n === "0"}
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({ label, on, onPress, lead }: { label: string; on: boolean; onPress: () => void; lead?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
    >
      {on ? <CheckIcon size={12} weight="bold" color="#0b0d0c" /> : lead}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#0c100e",
    boxShadow: "0 -20px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.14)", marginBottom: space[3] },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 18, color: color.text },
  resetPill: { height: 32, paddingHorizontal: space[3], marginRight: -space[3], borderRadius: radius.pill, justifyContent: "center" },
  reset: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  body: { paddingTop: 22, paddingBottom: 22, gap: 22 },
  group: { gap: 10 },
  groupLabel: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  chipOn: { backgroundColor: "#eceadf" },
  chipPressed: { transform: [{ scale: 0.97 }] },
  chipText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  chipTextOn: { fontFamily: font.medium, color: "#0b0d0c" },
  rangeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: -8 },
  rangeValue: { fontFamily: font.regular, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  rangeLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: -8 },
  rangeLabel: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
});
