/**
 * Someone else's profile: who they are and where they rank, who you both
 * know, Follow and the bell (tell me when they post), their record, and
 * three lists — their calls, what they hold now (unless they keep it
 * private), and the rooms they're in.
 */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import type { FeedPage, MarketPage, RoomSummaryDTO, TraderDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { useConfig } from "~/features/auth/auth";
import { Notice } from "~/features/home/notice";
import { RoomTile } from "~/features/rooms/room-tile";
import { api, API_URL } from "~/lib/api";
import { ago, count, price, signedUsd } from "~/lib/format";
import { bestBid } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";

type Tab = "calls" | "open" | "rooms";
type Person = { id: string; handle: string; name: string; avatarUrl: string };

const compact = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "+";
  if (d >= 1e6) return `${sign}$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `${sign}$${(d / 1e3).toFixed(1)}K`;
  return `${sign}$${d.toFixed(2)}`;
};

export default function TraderScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const insets = useSafeAreaInsets();
  const snapshot = useConfig().data?.dataSnapshot;
  const [opened] = useState(() => Date.now());
  const now = snapshot ? Date.parse(snapshot) : opened;
  const [tab, setTab] = useState<Tab>("calls");
  const [following, setFollowing] = useState<boolean | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);

  const trader = useQuery({ queryKey: ["trader", handle], queryFn: ({ signal }) => api<TraderDTO>(`/traders/${handle}`, { signal }) });
  const posts = useQuery({
    queryKey: ["feed", "trader", handle],
    queryFn: ({ signal }) => api<FeedPage>("/posts", { query: { trader: handle, limit: 30 }, signal }),
  });
  const followers = useQuery({
    queryKey: ["trader", handle, "followers"],
    queryFn: ({ signal }) => api<{ items: Person[] }>(`/traders/${handle}/followers`, { query: { limit: 100 }, signal }),
  });
  const mine = useQuery({ queryKey: ["me", "following"], queryFn: ({ signal }) => api<{ items: Person[] }>("/me/following", { signal }) });
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: ({ signal }) => api<{ items: RoomSummaryDTO[] }>("/rooms", { query: { limit: 100 }, signal }),
    enabled: tab === "rooms",
  });

  const t = trader.data;
  const items = posts.data?.items ?? [];
  const open = (t?.history ?? []).filter((h) => !("exitPrice" in h) || h.exitPrice == null);
  const slugs = [...new Set([...items.map((p) => p.marketId), ...open.map((h) => h.marketId)])];
  const markets = useQuery({
    queryKey: ["markets", "byIds", slugs.join(",")],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { ids: slugs.join(","), limit: Math.min(100, slugs.length) }, signal }),
    enabled: slugs.length > 0,
  });
  const marketOf = new Map((markets.data?.items ?? []).map((m) => [m.id, m]));

  // People you follow who follow them too.
  const mineIds = new Set((mine.data?.items ?? []).map((p) => p.id));
  const mutual = (followers.data?.items ?? []).filter((p) => mineIds.has(p.id));

  const isFollowing = following ?? t?.viewer?.following ?? false;
  const isNotified = notify ?? t?.viewer?.notify ?? false;

  async function toggleFollow() {
    const next = !isFollowing;
    setFollowing(next);
    if (!next) setNotify(false);
    try {
      await api(`/traders/${handle}/follow`, { method: next ? "PUT" : "DELETE" });
    } catch {
      setFollowing(!next);
    }
  }
  async function toggleBell() {
    const next = !isNotified;
    setNotify(next);
    try {
      await api(`/traders/${handle}/bell`, { method: next ? "PUT" : "DELETE" });
      if (next) setFollowing(true);
    } catch {
      setNotify(!next);
    }
  }

  // Their calls, newest first; resolved ones say whether they were right.
  const calls = items.map((p) => {
    const m = marketOf.get(p.marketId);
    const resolved = m?.status === "resolved";
    const right = resolved ? m!.resolution.outcome === p.outcome : null;
    const move = m && !resolved ? Math.round((bestBid(m, p.outcome) - p.entryPrice) * 10) / 10 : null;
    return { p, m, resolved, right, move };
  });
  // Recent results: resolved calls first; positions they've closed fill in the rest (green = closed at a profit).
  const closedResults = (t?.history ?? [])
    .filter((h): h is typeof h & { exitPrice: number } => "exitPrice" in h && typeof h.exitPrice === "number")
    .map((h) => ({ key: `${h.marketId}:${h.outcome}`, good: h.exitPrice > h.entryPrice }));
  const last5 = [
    ...calls.filter((c) => c.right !== null).map((c) => ({ key: c.p.id, good: !!c.right })),
    ...closedResults,
  ].slice(0, 5);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel="Back">
        <CaretLeftIcon size={22} weight="bold" color={color.text} />
      </Pressable>
      <View style={{ flex: 1 }} />
      {t ? (
        <Pressable
          onPress={() => Share.share({ message: `${t.name} on imo: ${API_URL}/trader/${t.handle}` })}
          hitSlop={8}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Share profile"
        >
          <ExportIcon size={21} color={color.text} />
        </Pressable>
      ) : null}
    </View>
  );

  if (trader.isError)
    return (
      <View style={styles.screen}>
        {header}
        <Notice title="This profile didn't load" body={trader.error.message} action={{ label: "Try again", onPress: () => trader.refetch() }} />
      </View>
    );
  if (!t)
    return (
      <View style={styles.screen}>
        {header}
        <View style={[styles.pad, { gap: space[3] }]} accessibilityLabel="Loading the profile" accessibilityRole="progressbar">
          <Skeleton width={72} height={72} round />
          <Skeleton width={180} height={20} />
          <Skeleton height={12} />
          <Skeleton height={48} round />
        </View>
      </View>
    );

  const stat30 = t.stats["30D"];
  const all = t.stats.All;
  const rightPct = all.resolved ? Math.round((all.correct / all.resolved) * 100) : null;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}>
        <View style={styles.pad}>
          <View style={styles.who}>
            <Avatar url={t.avatarUrl} size={72} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {t.name}
                </Text>
                {t.rank30 ? (
                  <View style={styles.rank}>
                    <Text style={styles.rankText}>#{t.rank30}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.small}>{[`@${t.handle}`, t.focus].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
          {t.bio ? <Text style={styles.bio}>{t.bio}</Text> : null}
          <Text style={styles.small}>
            <Text style={styles.strong}>{count(t.followers)}</Text> followers{"   "}
            <Text style={styles.strong}>{count(t.following)}</Text> following
          </Text>
          {mutual.length ? (
            <View style={styles.mutual}>
              <View style={styles.faces}>
                {mutual.slice(0, 3).map((p, i) => (
                  <View key={p.id} style={[styles.face, { marginLeft: i ? -8 : 0 }]}>
                    <Avatar url={p.avatarUrl} size={20} />
                  </View>
                ))}
              </View>
              <Text style={styles.small}>
                Followed by {mutual.slice(0, 2).map((p) => p.name.split(" ")[0]).join(" and ")}
                {mutual.length > 2 ? ` and ${mutual.length - 2} more you follow` : ""}
              </Text>
            </View>
          ) : null}

          {!t.isYou ? (
            <View style={styles.actions}>
              <Button
                size="lg"
                variant={isFollowing ? "outline" : "primary"}
                label={isFollowing ? "Following" : "Follow"}
                onPress={toggleFollow}
                style={{ flex: 1 }}
                accessibilityLabel={`${isFollowing ? "Unfollow" : "Follow"} ${t.name}`}
              />
              <Pressable
                onPress={toggleBell}
                style={[styles.bell, isNotified && styles.bellOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: isNotified }}
                accessibilityLabel={`Notify me when ${t.name.split(" ")[0]} posts`}
              >
                <BellIcon size={20} weight={isNotified ? "fill" : "regular"} color={isNotified ? color.pos : color.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.small}>30D P&L</Text>
            <Text style={[styles.statBig, { color: stat30.pnlCents < 0 ? color.neg : color.pos }]}>{compact(stat30.pnlCents)}</Text>
          </View>
          <View style={[styles.stat, styles.statMid]}>
            <Text style={styles.small}>Called right</Text>
            <Text style={styles.statValue}>
              {rightPct !== null ? `${rightPct}%` : "—"} <Text style={styles.small}>of {count(all.resolved)}</Text>
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.small}>Last {last5.length || 5}</Text>
            <View style={styles.dots} accessible accessibilityLabel={`Last ${last5.length}: ${last5.map((r) => (r.good ? "won" : "lost")).join(", ")}`}>
              {last5.length ? last5.map((r) => <View key={r.key} style={[styles.dot, { backgroundColor: r.good ? color.pos : color.neg }]} />) : <Text style={styles.small}>—</Text>}
            </View>
          </View>
        </View>

        <View style={styles.tabs}>
          {(
            [
              ["calls", "Calls"],
              ["open", "Open positions"],
              ["rooms", "Rooms"],
            ] as const
          ).map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => setTab(id)}
              style={[styles.tab, tab === id && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: tab === id }}
            >
              <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "calls" ? (
          posts.isPending ? (
            <View style={styles.pad}>
              <Skeleton height={44} />
            </View>
          ) : calls.length ? (
            calls.map(({ p, m, resolved, right, move }) => (
              <Pressable key={p.id} onPress={() => router.push(`/post/${p.id}`)} style={styles.call} accessibilityRole="link">
                <View style={[styles.callDot, { backgroundColor: right === false ? color.neg : color.pos }]} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.callTitle} numberOfLines={1}>
                    {m?.shortTitle || m?.title || p.marketId}
                  </Text>
                  <Text style={styles.small}>
                    {resolved ? `Resolved ${m!.resolution.outcome ?? "void"}` : "Open"} · {ago(p.at, now)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={[styles.side, { backgroundColor: p.outcome === "Yes" ? color.pos200 : color.neg200 }]}>
                    <Text style={[styles.sideText, { color: p.outcome === "Yes" ? color.pos : color.neg }]}>
                      {p.outcome} {price(p.entryPrice)}
                    </Text>
                  </View>
                  {right !== null ? (
                    <Text style={[styles.small, { color: right ? color.pos : color.neg }]}>{right ? "Right" : "Wrong"}</Text>
                  ) : move !== null ? (
                    <Text style={[styles.small, { color: move < 0 ? color.neg : color.pos }]}>
                      {move >= 0 ? "+" : "−"}
                      {Math.abs(move)}¢ now
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          ) : (
            <Notice title="No calls yet" body={`When ${t.name.split(" ")[0]} shares a take, it shows here.`} />
          )
        ) : tab === "open" ? (
          t.openPositionsHidden ? (
            <Notice title="Kept private" body={`${t.name.split(" ")[0]} doesn't share open positions. Their record above still counts every result.`} />
          ) : open.length ? (
            open.map((h) => {
              const m = marketOf.get(h.marketId);
              const now = m ? bestBid(m, h.outcome) : null;
              const pnl = now !== null ? (now - h.entryPrice) * h.shares : null;
              return (
                <Pressable key={`${h.marketId}:${h.outcome}`} onPress={() => router.push(`/market/${h.marketId}`)} style={styles.call} accessibilityRole="link">
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.callTitle} numberOfLines={1}>
                      {m?.shortTitle || m?.title || h.marketId}
                    </Text>
                    <Text style={styles.small}>
                      {h.shares.toLocaleString("en-US")} {h.outcome} at {price(h.entryPrice)}
                      {now !== null ? ` · now ${price(now)}` : ""}
                    </Text>
                  </View>
                  {pnl !== null ? <Text style={[styles.callTitle, { color: pnl < 0 ? color.neg : color.pos }]}>{signedUsd(Math.round(pnl))}</Text> : null}
                </Pressable>
              );
            })
          ) : (
            <Notice title="Nothing open" body="No positions right now." />
          )
        ) : (
          (rooms.data?.items ?? [])
            .filter((r) => t.roomIds.includes(r.id))
            .map((r) => (
              <Pressable key={r.id} onPress={() => router.push(`/room/${r.id}`)} style={styles.call} accessibilityRole="link">
                <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} size={36} muted={!r.role} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.callTitle}>{r.name}</Text>
                  <Text style={styles.small}>
                    {r.memberCount.toLocaleString("en-US")} members{r.role ? " · you're in" : ""}
                  </Text>
                </View>
              </Pressable>
            ))
        )}
        {tab === "rooms" && rooms.isSuccess && !t.roomIds.length ? <Notice title="No rooms" body="Not in any rooms yet." /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[3], paddingBottom: space[2] },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pad: { paddingHorizontal: space[4], gap: space[3] },
  who: { flexDirection: "row", alignItems: "center", gap: space[4] },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, fontFamily: font.medium, fontSize: 26, letterSpacing: -0.6, color: color.text },
  rank: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.chip, backgroundColor: color.gold200 },
  rankText: { fontFamily: font.semibold, fontSize: 11, color: color.gold },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700, fontVariant: ["tabular-nums"] },
  strong: { fontFamily: font.semibold, color: color.text },
  bio: { fontFamily: font.regular, fontSize: text.post, lineHeight: 22, color: color.text },
  mutual: { flexDirection: "row", alignItems: "center", gap: 8 },
  faces: { flexDirection: "row" },
  face: { borderRadius: 11, borderWidth: 1.5, borderColor: color.bg },
  actions: { flexDirection: "row", gap: space[3], marginTop: space[1] },
  bell: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.neutral400 },
  bellOn: { borderColor: color.posLine, backgroundColor: "#15211a" },
  stats: {
    flexDirection: "row",
    marginHorizontal: space[4],
    marginTop: space[5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  stat: { flex: 1, gap: 8, paddingVertical: space[4], paddingLeft: space[3] },
  statMid: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: color.neutral400 },
  statBig: { fontFamily: font.medium, fontSize: 22, fontVariant: ["tabular-nums"] },
  statValue: { fontFamily: font.medium, fontSize: 22, color: color.text, fontVariant: ["tabular-nums"] },
  dots: { flexDirection: "row", gap: 5, height: 26, alignItems: "center" },
  dot: { width: 9, height: 9, borderRadius: 5 },
  tabs: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[4] },
  tab: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  tabOn: { backgroundColor: "#eceadf" },
  tabText: { fontFamily: font.medium, fontSize: text.ui, color: color.neutral800 },
  tabTextOn: { color: "#0b0d0c" },
  call: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: 11 },
  callDot: { width: 7, height: 7, borderRadius: 4 },
  callTitle: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text, fontVariant: ["tabular-nums"] },
  side: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  sideText: { fontFamily: font.semibold, fontSize: 11, fontVariant: ["tabular-nums"] },
});
