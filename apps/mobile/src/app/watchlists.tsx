/**
 * Watchlists: your lists of markets, one at a time. A line on how the list
 * moved today, then each market with its recent line, price and move.
 * Swipe a row left to take it off the list; + starts a new list.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { HandSwipeLeftIcon } from "phosphor-react-native/src/icons/HandSwipeLeft";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type { MarketDTO, MarketPage, WatchlistsDTO } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { Sparkline } from "~/features/discover/sparkline";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

type List = WatchlistsDTO["items"][number];

export default function Watchlists() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const venues = useVenues();
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const lists = useQuery({ queryKey: ["watchlists"], queryFn: ({ signal }) => api<WatchlistsDTO>("/watchlists", { signal }) });
  // Named lists first, then the default "Saved markets".
  const all = [...(lists.data?.items ?? [])].sort((a, b) => Number(a.isDefault) - Number(b.isDefault));
  const list: List | undefined = all.find((l) => l.id === picked) ?? all[0];
  const ids = list?.marketIds ?? [];

  const markets = useQuery({
    queryKey: ["markets", "byIds", ids.join(",")],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { ids: ids.join(","), limit: Math.max(1, ids.length) }, signal }),
    enabled: ids.length > 0,
  });
  const bySlug = new Map((markets.data?.items ?? []).map((m) => [m.id, m]));
  const rows = ids.map((id) => bySlug.get(id)).filter((m): m is MarketDTO => !!m);

  const up = rows.filter((m) => m.status !== "resolved" && m.change > 0).length;
  const down = rows.filter((m) => m.status !== "resolved" && m.change < 0).length;
  const resolved = rows.filter((m) => m.status === "resolved").length;

  async function remove(slug: string) {
    if (!list) return;
    queryClient.setQueryData<WatchlistsDTO>(["watchlists"], (d) =>
      d ? { items: d.items.map((l) => (l.id === list.id ? { ...l, marketIds: l.marketIds.filter((x) => x !== slug) } : l)) } : d,
    );
    try {
      await api(`/watchlists/${list.id}/markets/${slug}`, { method: "DELETE" });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Watchlists</Text>
        <Pressable onPress={() => setCreating(true)} style={styles.add} accessibilityRole="button" accessibilityLabel="New watchlist">
          <PlusIcon size={18} weight="bold" color={color.text} />
        </Pressable>
      </View>

      {lists.isError ? (
        <Notice title="Your lists didn't load" body={lists.error.message} action={{ label: "Try again", onPress: () => lists.refetch() }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {all.map((l) => {
              const on = l.id === list?.id;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => setPicked(l.id)}
                  style={[styles.tab, on && styles.tabOn]}
                  accessibilityRole="tab"
                  accessibilityLabel={`${l.name}, ${l.marketIds.length}`}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{l.name}</Text>
                  <Text style={[styles.count, on && styles.tabTextOn]}>{l.marketIds.length}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {rows.length ? (
            <View style={styles.summary}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.small}>Today across this list</Text>
                <Text style={styles.summaryText}>
                  {up} up · {down} down{resolved ? ` · ${resolved} resolved` : ""}
                </Text>
              </View>
              <Bars up={up} down={down} resolved={resolved} />
            </View>
          ) : null}

          {lists.isPending || (ids.length && markets.isPending) ? (
            <View style={{ padding: space[4], gap: space[4] }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={44} />
              ))}
            </View>
          ) : !ids.length ? (
            <Notice title="Nothing on this list yet" body="Tap the bookmark on any market to save it, then sort it into a list." />
          ) : (
            rows.map((m) => (
              <Swipeable
                key={m.id}
                friction={2}
                rightThreshold={60}
                overshootRight={false}
                renderRightActions={() => (
                  <Pressable onPress={() => remove(m.id)} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${m.title}`}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                )}
              >
                <Row market={m} venue={venues.get(m.venueId)?.name ?? m.venueId} onRemove={() => remove(m.id)} />
              </Swipeable>
            ))
          )}

          {rows.length ? (
            <View style={styles.hint}>
              <HandSwipeLeftIcon size={15} color={color.neutral600} />
              <Text style={styles.small}>Swipe a row left to remove</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      <NewList
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setPicked(id);
          setCreating(false);
        }}
      />
    </View>
  );
}

function Row({ market: m, venue, onRemove }: { market: MarketDTO; venue: string; onRemove: () => void }) {
  const resolved = m.status === "resolved";
  const date = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <Pressable
      onPress={() => router.push(`/market/${m.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="link"
      // Screen readers can't swipe: removing is an action on the row too.
      accessibilityActions={[{ name: "remove", label: "Remove from list" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "remove" && onRemove()}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {m.shortTitle || m.title}
        </Text>
        <Text style={styles.small}>
          {venue} · {resolved ? `resolved ${date}` : `Closes ${date}`}
        </Text>
      </View>
      <View style={[styles.spark, resolved && { opacity: 0.4 }]}>{m.series.length > 1 ? <Sparkline points={m.series} height={26} /> : null}</View>
      <View style={styles.figure}>
        <Text style={styles.price}>{resolved ? m.resolution.outcome ?? "Void" : price(m.yesPrice)}</Text>
        <Text style={[styles.change, { color: resolved || !m.change ? color.neutral700 : m.change > 0 ? color.pos : color.neg }]}>
          {resolved ? "resolved" : m.change ? `${m.change > 0 ? "▲" : "▼"} ${Math.abs(m.change)}¢` : "no change"}
        </Text>
      </View>
    </Pressable>
  );
}

/** Up, down and resolved as three little stacks, the summary's mark. */
function Bars({ up, down, resolved }: { up: number; down: number; resolved: number }) {
  const max = Math.max(1, up, down, resolved);
  const bar = (n: number, c: string) => <View style={[styles.bar, { height: 4 + (n / max) * 18, backgroundColor: n ? c : color.neutral400 }]} />;
  return (
    <View style={styles.bars} accessibilityElementsHidden>
      {bar(up, color.pos)}
      {bar(down, color.neg)}
      {bar(resolved, color.neutral600)}
    </View>
  );
}

function NewList({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const list = await api<{ id: string }>("/watchlists", { body: { name: name.trim() } });
      await queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setName("");
      onCreated(list.id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.dialog}>
        <Text style={styles.dialogTitle}>New watchlist</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Rates & inflation"
          placeholderTextColor={color.neutral600}
          autoFocus
          maxLength={40}
          style={styles.dialogInput}
          accessibilityLabel="List name"
          onSubmitEditing={() => name.trim() && create()}
        />
        <Button label="Create" onPress={create} disabled={!name.trim()} loading={busy} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  head: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], marginBottom: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 28, letterSpacing: -0.8, color: color.text },
  add: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral200 },
  tabs: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[3] },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.neutral200 },
  tabOn: { backgroundColor: "#eceadf" },
  tabText: { fontFamily: font.medium, fontSize: text.body, color: color.neutral800 },
  tabTextOn: { color: "#0b0d0c" },
  count: { fontFamily: font.regular, fontSize: 12, color: color.neutral600 },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: space[4],
    marginBottom: space[3],
    padding: space[4],
    borderRadius: radius.panel,
    backgroundColor: "#121714",
  },
  small: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  summaryText: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 24 },
  bar: { width: 6, borderRadius: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: 12, backgroundColor: color.bg },
  pressed: { backgroundColor: color.neutral100 },
  rowTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  spark: { width: 64 },
  figure: { alignItems: "flex-end", gap: 3, minWidth: 64 },
  price: { fontFamily: font.semibold, fontSize: 16, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.medium, fontSize: 11, fontVariant: ["tabular-nums"] },
  remove: { width: 96, alignItems: "center", justifyContent: "center", backgroundColor: "#5a2a24" },
  removeText: { fontFamily: font.semibold, fontSize: text.body, color: color.neg },
  hint: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space[4], paddingTop: space[4] },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  dialog: {
    position: "absolute",
    left: space[5],
    right: space[5],
    top: "30%",
    gap: space[3],
    padding: space[5],
    borderRadius: radius.drawer,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  dialogTitle: { fontFamily: font.medium, fontSize: 18, color: color.text },
  dialogInput: {
    height: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.field,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral400,
    fontFamily: font.regular,
    fontSize: 16,
    color: color.text,
  },
});
