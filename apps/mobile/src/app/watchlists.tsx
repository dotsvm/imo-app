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
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { HandSwipeLeftIcon } from "phosphor-react-native/src/icons/HandSwipeLeft";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type { MarketDTO, MarketPage, WatchlistsDTO } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { TrendLine } from "~/features/markets/trend-line";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { price } from "~/lib/format";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space } from "~/theme/tokens";

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
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <View style={styles.head}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => [styles.back, pressed && styles.circlePressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <CaretLeftIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Watchlists
        </Text>
        <Pressable
          onPress={() => setCreating(true)}
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          accessibilityRole="button"
          accessibilityLabel="New watchlist"
        >
          <PlusIcon size={16} weight="bold" color={color.text} />
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
                  <Text style={[styles.tabText, styles.count, on && styles.tabTextOn]}>{l.marketIds.length}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {rows.length ? (
            <View style={styles.summary}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.small}>Today across this list</Text>
                <Text style={styles.summaryText}>
                  {up} up · {down} down{resolved ? ` · ${resolved} resolved` : ""}
                </Text>
              </View>
              <Bars markets={rows} />
            </View>
          ) : null}

          {lists.isPending || (ids.length && markets.isPending) ? (
            <View accessibilityLabel="Loading the list" accessibilityRole="progressbar">
              <View style={styles.summary}>
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton width={130} height={10} />
                  <Skeleton width={170} height={14} />
                </View>
              </View>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.row}>
                  <View style={{ flex: 1, gap: 7 }}>
                    <Skeleton width="70%" height={13} />
                    <Skeleton width={120} height={10} />
                  </View>
                  <Skeleton width={64} height={24} />
                  <Skeleton width={44} height={28} />
                </View>
              ))}
            </View>
          ) : markets.isError ? (
            <Notice title="This list's markets didn't load" body={markets.error.message} action={{ label: "Try again", onPress: () => markets.refetch() }} />
          ) : !ids.length ? (
            <Notice
              icon={<BookmarkSimpleIcon size={26} weight="fill" color={color.muted} />}
              title="This list is empty"
              body="Save markets from Discover, a post or a room with the bookmark icon."
              action={{ label: "Find markets", onPress: () => router.navigate("/(tabs)/discover") }}
            />
          ) : (
            rows.map((m) => (
              <Swipeable
                key={m.id}
                friction={2}
                rightThreshold={60}
                overshootRight={false}
                renderRightActions={() => (
                  <View style={styles.removeWrap}>
                    <Pressable onPress={() => remove(m.id)} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${m.title}`}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              >
                <Row market={m} venue={venues.get(m.venueId)?.name ?? m.venueId} onRemove={() => remove(m.id)} />
              </Swipeable>
            ))
          )}

          {rows.length ? (
            <View style={styles.hint}>
              <HandSwipeLeftIcon size={14} weight="bold" color={color.muted} />
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
  const trend = resolved || !m.change ? "rgba(255, 255, 255, 0.3)" : m.change > 0 ? color.gain : color.neg;
  return (
    <Pressable
      onPress={() => router.push(`/market/${m.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="link"
      // Screen readers can't swipe: removing is an action on the row too.
      accessibilityActions={[{ name: "remove", label: "Remove from list" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "remove" && onRemove()}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {m.shortTitle || m.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {venue} · {resolved ? `resolved ${date}` : `Closes ${date}`}
        </Text>
      </View>
      <View style={styles.spark}>
        {m.series.length > 1 ? <TrendLine points={m.series} height={24} width={64} stroke={trend} /> : null}
      </View>
      <View style={styles.figure}>
        <Text style={styles.price}>{resolved ? m.resolution.outcome ?? "Void" : price(m.yesPrice)}</Text>
        <Text style={[styles.change, { color: resolved || !m.change ? color.muted : m.change > 0 ? color.gain : color.neg }]}>
          {resolved ? "resolved" : m.change ? `${m.change > 0 ? "▲" : "▼"} ${Math.abs(m.change)}¢` : "no change"}
        </Text>
      </View>
    </Pressable>
  );
}

/** One bar per market (up to 8): up green, down coral, by how far it moved; flat or resolved a stub. */
function Bars({ markets }: { markets: MarketDTO[] }) {
  const moving = (m: MarketDTO) => m.status !== "resolved" && m.change !== 0;
  const order = [
    ...markets.filter((m) => moving(m) && m.change > 0),
    ...markets.filter((m) => moving(m) && m.change < 0),
    ...markets.filter((m) => !moving(m)),
  ].slice(0, 8);
  const max = Math.max(1, ...order.filter(moving).map((m) => Math.abs(m.change)));
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {order.map((m) => (
        <View
          key={m.id}
          style={[
            styles.bar,
            moving(m)
              ? { height: 4 + (Math.abs(m.change) / max) * 18, backgroundColor: m.change > 0 ? color.gain : color.neg }
              : { height: 4, backgroundColor: "rgba(255, 255, 255, 0.2)" },
          ]}
        />
      ))}
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
  head: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: space[2], paddingRight: space[4], marginBottom: space[3] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  circlePressed: { backgroundColor: color.card },
  title: { flex: 1, fontFamily: font.medium, fontSize: 26, letterSpacing: -0.52, color: color.text },
  add: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: color.card },
  addPressed: { backgroundColor: "#1b241f" },
  tabs: { gap: 6, paddingHorizontal: space[4], paddingBottom: 14 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.card },
  tabOn: { backgroundColor: color.text },
  tabText: { fontFamily: font.regular, fontSize: 13, color: "#c6cec6" },
  tabTextOn: { color: "#0c100e" },
  count: { fontSize: 11, opacity: 0.55, fontVariant: ["tabular-nums"] },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingVertical: 14,
    paddingHorizontal: space[4],
    borderRadius: 18,
    backgroundColor: color.card,
  },
  small: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  meta: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  summaryText: { fontFamily: font.medium, fontSize: 15, color: color.text, fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 26 },
  bar: { width: 6, borderRadius: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: space[3], backgroundColor: color.bg },
  pressed: { backgroundColor: color.neutral100 },
  rowTitle: { fontFamily: font.regular, fontSize: 14, lineHeight: 18, color: color.text },
  spark: { width: 64, height: 24 },
  figure: { alignItems: "flex-end", gap: 3, minWidth: 58 },
  price: { fontFamily: font.medium, fontSize: 15, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.regular, fontSize: 11, fontVariant: ["tabular-nums"] },
  removeWrap: { justifyContent: "center", paddingHorizontal: space[3] },
  remove: { height: 40, paddingHorizontal: space[4], borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: color.neg200, borderWidth: 1, borderColor: color.negLine },
  removeText: { fontFamily: font.semibold, fontSize: 13, color: color.neg },
  hint: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 14 },
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
