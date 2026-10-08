/**
 * Find a market and pick it: a floating sheet with a search field over open
 * markets (trending first). One tap picks; with `multi`, taps toggle and
 * Done closes. Used to seed a new room's markets and to link a market in a
 * room message.
 */
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useDeferredValue, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { MarketDTO, MarketPage } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { VenueMark } from "~/components/venue-mark";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space } from "~/theme/tokens";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (market: MarketDTO) => void;
  /** Slugs already chosen: shown checked. */
  selected?: string[];
  /** Taps toggle and the sheet stays open until Done. */
  multi?: boolean;
  /** No more can be added (e.g. a room's 20). */
  full?: boolean;
}

export function MarketPickerSheet({ open, title, onClose, onPick, selected = [], multi, full }: Props) {
  const insets = useSafeAreaInsets();
  const venues = useVenues();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const markets = useQuery({
    queryKey: ["markets", "pick", search],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", { query: { status: "open", sort: "trending", q: search || undefined, limit: 30 }, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  function pick(m: MarketDTO) {
    if (full && !selected.includes(m.id)) return;
    Haptics.selectionAsync().catch(() => {});
    onPick(m);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.anchor} pointerEvents="box-none">
        <View style={[styles.sheet, { marginBottom: Math.max(insets.bottom, space[2]) }]}>
          <View style={styles.grip} />
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={15} weight="bold" color={color.text} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <MagnifyingGlassIcon size={16} weight="bold" color={color.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search markets"
              placeholderTextColor={color.muted}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.input}
              accessibilityLabel="Search markets"
            />
          </View>
          {markets.isPending ? (
            <View style={styles.list}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.row}>
                  <Skeleton width={32} height={32} round />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width="75%" height={13} />
                    <Skeleton width={120} height={10} />
                  </View>
                </View>
              ))}
            </View>
          ) : markets.isError ? (
            <Text style={styles.empty}>Markets didn&apos;t load. {markets.error.message}</Text>
          ) : (
            <FlatList
              data={markets.data.items}
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>No open markets match. Try another word.</Text>}
              renderItem={({ item: m }) => {
                const on = selected.includes(m.id);
                return (
                  <Pressable
                    onPress={() => pick(m)}
                    disabled={full && !on}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed, full && !on && styles.rowOff]}
                    accessibilityRole={multi ? "checkbox" : "button"}
                    accessibilityState={multi ? { checked: on } : undefined}
                    accessibilityLabel={`${m.shortTitle || m.title}, Yes ${price(m.yesPrice)}`}
                  >
                    <VenueMark venueId={m.venueId} size={32} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {m.shortTitle || m.title}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {venues.get(m.venueId)?.name ?? m.venueId} · Yes {price(m.yesPrice)}
                      </Text>
                    </View>
                    {multi ? (
                      <View style={[styles.check, on && styles.checkOn]}>{on ? <CheckIcon size={13} weight="bold" color={PRIMARY_INK} /> : null}</View>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
          {multi ? <Button size="lg" label={selected.length ? `Done · ${selected.length}` : "Done"} onPress={onClose} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(4, 6, 5, 0.55)" },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "86%",
    marginHorizontal: 8,
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: 10,
    paddingBottom: space[4],
    borderRadius: 32,
    backgroundColor: "#121815",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 -20px 60px -20px rgba(0,0,0,0.8)",
  },
  grip: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  head: { flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[2] },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4, color: color.text },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 44, paddingHorizontal: space[4], borderRadius: radius.pill, backgroundColor: "#1b241f" },
  input: { flex: 1, fontFamily: font.regular, fontSize: 14, color: color.text },
  list: { minHeight: 200 },
  empty: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.muted, paddingVertical: space[5], textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10 },
  rowPressed: { opacity: 0.7 },
  rowOff: { opacity: 0.42 },
  rowTitle: { fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: color.text },
  rowMeta: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: color.pos, borderColor: color.pos },
});
