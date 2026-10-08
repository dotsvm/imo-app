/**
 * Search markets, traders and rooms. Results come in sections, with a scope
 * row to narrow them. When nothing matches, say so, then offer what's close
 * (the same search, word by word) and a few things people are trading now.
 */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";
import type { MarketPage, SearchDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { setFollowing } from "~/features/auth/onboarding";
import { MarketRow } from "~/features/discover/market-row";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

type Scope = "all" | "markets" | "traders" | "rooms";
type Room = SearchDTO["rooms"][number];
type Trader = SearchDTO["traders"][number];

const search = (q: string, signal?: AbortSignal) =>
  api<SearchDTO>("/search", { query: { q }, signal });
const total = (r: SearchDTO) =>
  r.markets.length + r.traders.length + r.rooms.length;

export default function Search() {
  const insets = useSafeAreaInsets();
  const venues = useVenues();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const term = useDeferredValue(q.trim());
  const active = term.length >= 2;

  const results = useQuery({
    queryKey: ["search", term],
    queryFn: ({ signal }) => search(term, signal),
    enabled: active,
    placeholderData: (prev) => prev,
  });
  const r = active ? results.data : undefined;
  const empty = !!r && total(r) === 0 && !results.isFetching;

  // Nothing for the whole phrase: try its words, longest first, until one finds something.
  const closest = useQuery({
    queryKey: ["search", "closest", term],
    queryFn: async ({ signal }) => {
      const words = [
        ...new Set(term.split(/\s+/).filter((w) => w.length >= 3)),
      ].sort((a, b) => b.length - a.length);
      for (const w of words) {
        const found = await search(w, signal);
        if (total(found)) return found;
      }
      return null;
    },
    enabled: empty,
  });
  const trending = useQuery({
    queryKey: ["markets", "trending", "suggest"],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { sort: "trending", limit: 6 },
        signal,
      }),
    enabled: empty,
    staleTime: 5 * 60_000,
  });

  const venueName = (id: string) => venues.get(id)?.name ?? id;
  // Short, real things people trade now: a market's short title, kept chip-sized.
  const suggestions = [
    ...new Set((trending.data?.items ?? []).map((m) => m.shortTitle || m.title).filter((t) => t.length <= 28)),
  ].slice(0, 4);
  const show = (s: Exclude<Scope, "all">) => scope === "all" || scope === s;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.bar}>
        <View style={styles.field}>
          <MagnifyingGlassIcon size={16} weight="bold" color={color.neutral700} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search markets, traders, rooms"
            placeholderTextColor={color.neutral600}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            cursorColor={color.pos}
            selectionColor={color.pos}
            style={styles.input}
            accessibilityLabel="Search"
          />
          {q ? (
            <Pressable onPress={() => setQ("")} hitSlop={8} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear search">
              <XCircleIcon size={18} weight="fill" color={color.neutral700} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      {r && !empty ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopes} style={styles.scopeRow}>
          {(
            [
              ["all", "All", null],
              ["markets", "Markets", r.markets.length],
              ["traders", "Traders", r.traders.length],
              ["rooms", "Rooms", r.rooms.length],
            ] as const
          ).map(([id, label, n]) => {
            const on = scope === id;
            return (
              <Pressable
                key={id}
                onPress={() => setScope(id)}
                style={[styles.scope, on && styles.scopeOn]}
                accessibilityRole="tab"
                accessibilityLabel={n === null ? label : `${label}, ${n}`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.scopeText, on && styles.scopeTextOn]}>{label}</Text>
                {n !== null ? <Text style={[styles.scopeCount, on && styles.scopeTextOn]}>{n}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}>
        {!active ? (
          <Text style={styles.hint}>Find a market by its question, a trader by name or handle, or a room.</Text>
        ) : results.isError && !r ? (
          <Notice
            title="Search didn't load"
            body={results.error.message}
            action={{ label: "Try again", onPress: () => results.refetch() }}
          />
        ) : !r ? (
          <View style={styles.loading} accessibilityLabel="Searching" accessibilityRole="progressbar">
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ gap: 6 }}>
                <Skeleton width="85%" height={14} />
                <Skeleton width={150} height={11} />
              </View>
            ))}
          </View>
        ) : empty ? (
          <View style={styles.none}>
            <Text style={styles.noneTitle}>Nothing yet.</Text>
            <Text style={styles.noneBody}>
              No markets, traders or rooms match “{term}”. Try fewer words, or a different one.
            </Text>
            {closest.data ? (
              <>
                <Text style={[styles.noneLabel, { marginTop: 40 }]}>Closest matches</Text>
                {closest.data.markets.slice(0, 2).map((m) => (
                  <MarketRow
                    key={m.id}
                    market={m}
                    venue={venueName(m.venueId)}
                    variant="search"
                    flush
                    onPress={() => router.push(`/market/${m.id}`)}
                  />
                ))}
                {closest.data.traders.slice(0, 2).map((t) => (
                  <TraderRow key={t.id} trader={t} flush />
                ))}
                {closest.data.rooms.slice(0, 2).map((room) => (
                  <RoomRow key={room.id} room={room} flush />
                ))}
              </>
            ) : null}
            {suggestions.length ? (
              <>
                <Text style={[styles.noneLabel, { marginTop: 28 }]}>Try searching</Text>
                <View style={styles.tries}>
                  {suggestions.map((label) => (
                    <Pressable
                      key={label}
                      onPress={() => setQ(label)}
                      style={({ pressed }) => [styles.try, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Search ${label}`}
                    >
                      <Text style={styles.tryText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : (
          <>
            {show("markets") && r.markets.length ? (
              <>
                <Text style={styles.section}>Markets</Text>
                {r.markets.map((m) => (
                  <MarketRow
                    key={m.id}
                    market={m}
                    venue={venueName(m.venueId)}
                    variant="search"
                    onPress={() => router.push(`/market/${m.id}`)}
                  />
                ))}
              </>
            ) : null}
            {show("traders") && r.traders.length ? (
              <>
                <Text style={styles.section}>Traders</Text>
                {r.traders.map((t) => (
                  <TraderRow key={t.id} trader={t} />
                ))}
              </>
            ) : null}
            {show("rooms") && r.rooms.length ? (
              <>
                <Text style={styles.section}>Rooms</Text>
                {r.rooms.map((room) => (
                  <RoomRow key={room.id} room={room} />
                ))}
              </>
            ) : null}
            {scope !== "all" && !r[scope].length ? (
              <Text style={styles.hint}>
                No {scope} match “{term}”.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TraderRow({ trader: t, flush }: { trader: Trader; flush?: boolean }) {
  const [following, setState] = useState(t.viewer?.following ?? false);
  async function toggle() {
    setState(!following);
    try {
      await setFollowing(t.handle, !following);
    } catch {
      setState(following);
    }
  }
  return (
    <View style={[styles.row, flush && styles.flush]}>
      <Pressable
        onPress={() => openTrader(t.handle, t.isYou)}
        style={styles.traderLink}
        accessibilityRole="link"
      >
        <Avatar url={t.avatarUrl} size={40} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {t.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {t.focus || `@${t.handle}`}
          </Text>
        </View>
      </Pressable>
      {!t.isYou ? (
        <Button
          size="sm"
          variant={following ? "quiet" : "primary"}
          style={styles.follow}
          label={following ? "Following" : "Follow"}
          onPress={toggle}
          accessibilityLabel={`${following ? "Unfollow" : "Follow"} ${t.name}`}
        />
      ) : null}
    </View>
  );
}

function RoomRow({ room, flush }: { room: Room; flush?: boolean }) {
  const open = room.privacy === "Public";
  const [state, setState] = useState<"none" | "busy" | "joined" | "requested">(
    room.role ? "joined" : room.requested ? "requested" : "none",
  );
  async function join() {
    setState("busy");
    try {
      if (open) await api(`/rooms/${room.id}/join`, { method: "PUT" });
      else
        await api(`/rooms/${room.id}/requests`, { method: "POST", body: {} });
      setState(open ? "joined" : "requested");
    } catch {
      setState("none");
    }
  }
  const label =
    state === "joined"
      ? "Joined"
      : state === "requested"
        ? "Requested"
        : open
          ? "Join"
          : "Request";
  return (
    <View style={[styles.row, flush && styles.flushRoom]}>
      <View style={[styles.roomIcon, flush && styles.roomIconSmall]}>
        <UsersThreeIcon size={18} weight="fill" color={color.neutral800} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {room.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {flush ? "Room · " : ""}
          {room.memberCount.toLocaleString("en-US")} members
          {!flush && room.online ? ` · ${room.online} online` : ""}
        </Text>
      </View>
      <Pressable
        onPress={join}
        disabled={state !== "none"}
        hitSlop={6}
        style={({ pressed }) => [styles.join, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${room.name}`}
        accessibilityState={{ disabled: state !== "none", busy: state === "busy" }}
      >
        <Text style={[styles.joinText, state !== "none" && styles.joined]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pressed: { backgroundColor: color.neutral300 },
  bar: { flexDirection: "row", alignItems: "center", gap: space[1], paddingLeft: space[4], paddingRight: space[2], paddingBottom: space[3] },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingLeft: space[4],
    paddingRight: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
    borderWidth: 1,
    borderColor: color.neutral400,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: text.post, color: color.text, padding: 0 },
  clear: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cancel: { height: 44, paddingHorizontal: space[3], borderRadius: radius.pill, justifyContent: "center" },
  cancelText: { fontFamily: font.regular, fontSize: text.body, color: color.neutral800 },
  scopeRow: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  scopes: { gap: 6, paddingHorizontal: space[4], paddingBottom: space[3] },
  scope: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  scopeOn: { backgroundColor: "#eceadf" },
  scopeText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  scopeCount: { fontFamily: font.regular, fontSize: 11, color: color.neutral800, opacity: 0.6, fontVariant: ["tabular-nums"] },
  scopeTextOn: { color: "#0b0d0c" },
  hint: { fontFamily: font.regular, fontSize: text.body, lineHeight: 20, color: color.neutral700, padding: space[4] },
  loading: { gap: space[5], padding: space[4] },
  section: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral700,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  flush: { paddingHorizontal: 0 },
  flushRoom: { paddingHorizontal: 0, paddingVertical: space[3] },
  rowText: { flex: 1, gap: 3 },
  traderLink: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[3] },
  rowTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  rowMeta: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  follow: { height: 32 },
  roomIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.card,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.neutral200,
  },
  roomIconSmall: { width: 36, height: 36 },
  join: { height: 32, paddingHorizontal: space[3], borderRadius: radius.pill, justifyContent: "center", borderWidth: 1, borderColor: color.neutral400 },
  joinText: { fontFamily: font.medium, fontSize: 12, color: color.neutral800 },
  joined: { color: color.neutral600 },
  none: { paddingTop: 40, paddingHorizontal: space[5] },
  noneTitle: { fontFamily: font.displayItalic, fontSize: 44, lineHeight: 44, color: color.neutral600 },
  noneBody: { fontFamily: font.regular, fontSize: text.post, lineHeight: 22, color: color.neutral800, marginTop: 14 },
  noneLabel: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  tries: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  try: { height: 32, paddingHorizontal: 13, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  tryText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
});
