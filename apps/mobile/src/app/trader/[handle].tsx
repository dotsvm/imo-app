/**
 * Someone else's profile: who they are and where they rank, who you both
 * know, Follow and the bell (tell me when they post), their record, and
 * three lists — their calls, what they hold now (unless they keep it
 * private), and the rooms they're in. The ··· menu shares, copies the link,
 * or reports them.
 */
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellSimpleIcon } from "phosphor-react-native/src/icons/BellSimple";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { EyeSlashIcon } from "phosphor-react-native/src/icons/EyeSlash";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { LinkSimpleIcon } from "phosphor-react-native/src/icons/LinkSimple";
import type { FeedPage, LeaderboardDTO, MarketPage, RoomSummaryDTO, TraderDTO } from "@imo/server/dto/api-types";
import { ActionSheet } from "~/components/action-sheet";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { ChipTabs } from "~/components/chip-tabs";
import { CallRow, Figure, RecordDots, SideChip, Stat, StatGrid, StatValue, Sub } from "~/components/profile-parts";
import { BackCircle, HeaderIcon } from "~/components/screen-header";
import { Skeleton } from "~/components/skeleton";
import { useConfig } from "~/features/auth/auth";
import { Notice } from "~/features/home/notice";
import { RoomTile } from "~/features/rooms/room-tile";
import { api, API_URL } from "~/lib/api";
import { ago, count, price, signedUsd } from "~/lib/format";
import { bestBid } from "~/lib/market";
import { color, font, radius, space } from "~/theme/tokens";

type Tab = "calls" | "open" | "rooms";
type Person = { id: string; handle: string; name: string; avatarUrl: string };
const TABS = [
  { id: "calls", label: "Calls" },
  { id: "open", label: "Open positions" },
  { id: "rooms", label: "Rooms" },
] as const;
const REASONS = [
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "misleading", label: "Misleading" },
  { id: "impersonation", label: "Impersonation" },
  { id: "other", label: "Something else" },
] as const;

/** "+$18.4K", "−$180", "+$42.50" */
const compact = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "+";
  if (d >= 1e6) return `${sign}$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `${sign}$${(d / 1e3).toFixed(1)}K`;
  if (d >= 100) return `${sign}$${Math.round(d)}`;
  return `${sign}$${d.toFixed(2)}`;
};

/** "just now", "2h ago", "yesterday", "3d ago", then a date. */
function when(iso: string, now: number) {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s >= 86_400 && s < 2 * 86_400) return "yesterday";
  const a = ago(iso, now);
  if (a === "now") return "just now";
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : a;
}

const tick = () => {
  if (Platform.OS !== "web") Haptics.selectionAsync();
};

export default function TraderScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const insets = useSafeAreaInsets();
  const snapshot = useConfig().data?.dataSnapshot;
  const [opened] = useState(() => Date.now());
  const now = snapshot ? Date.parse(snapshot) : opened;
  const [tab, setTab] = useState<Tab>("calls");
  const [following, setFollowing] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [notify, setNotify] = useState<boolean | null>(null);
  const [menu, setMenu] = useState<"none" | "more" | "report">("none");

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
  // The board's minimum sample, for the private-positions caveat.
  const board = useQuery({
    queryKey: ["leaderboard", "minSample"],
    queryFn: ({ signal }) => api<LeaderboardDTO>("/leaderboard", { query: { limit: 1 }, signal }),
    enabled: !!t?.openPositionsHidden,
    staleTime: 10 * 60 * 1000,
  });
  const items = posts.data?.items ?? [];
  const history = t?.history ?? [];
  const open = history.filter((h) => !("exitPrice" in h) || h.exitPrice == null);
  const closed = history.filter((h): h is typeof h & { exitPrice: number } => "exitPrice" in h && typeof h.exitPrice === "number");
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
    tick();
    setPending(true);
    setFollowing(next);
    if (!next) setNotify(false);
    try {
      await api(`/traders/${handle}/follow`, { method: next ? "PUT" : "DELETE" });
    } catch {
      setFollowing(!next);
    } finally {
      setPending(false);
    }
  }
  async function toggleBell() {
    const next = !isNotified;
    tick();
    setNotify(next);
    try {
      await api(`/traders/${handle}/bell`, { method: next ? "PUT" : "DELETE" });
      if (next) setFollowing(true);
    } catch {
      setNotify(!next);
    }
  }
  async function report(reason: (typeof REASONS)[number]["id"]) {
    if (!t) return;
    try {
      await api("/reports", { body: { subjectType: "user", subjectId: t.id, reason } });
      Alert.alert("Thanks for telling us", `We'll take a look at @${t.handle}.`);
    } catch (error) {
      Alert.alert("Couldn't send that", error instanceof Error ? error.message : "Try again in a moment.");
    }
  }

  // Their calls, newest first. A resolved one shows what it made when their
  // history (or the post's disclosed position) says; otherwise Right/Wrong.
  const calls = items.map((p) => {
    const m = marketOf.get(p.marketId);
    const resolved = m?.status === "resolved";
    const outcome = resolved ? m!.resolution.outcome : null;
    const right = resolved && outcome ? outcome === p.outcome : null;
    const move = m && !resolved ? Math.round((bestBid(m, p.outcome) - p.entryPrice) * 10) / 10 : null;
    let result: number | null = null;
    if (resolved && outcome) {
      const row = closed.find((h) => h.marketId === p.marketId && h.outcome === p.outcome);
      if (row) result = Math.round((row.exitPrice - row.entryPrice) * row.shares - row.feeCents);
      else if (p.position) result = Math.round(((outcome === p.outcome ? 100 : 0) - p.position.averagePriceCents) * p.position.shares);
    }
    return { p, m, resolved, outcome, right, move, result };
  });
  // Recent results: resolved calls first; positions they've closed fill in the rest (green = closed at a profit).
  const last5 = [
    ...calls.filter((c) => c.right !== null).map((c) => !!c.right),
    ...closed.map((h) => h.exitPrice > h.entryPrice),
  ].slice(0, 5);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <BackCircle />
      <View style={{ flex: 1 }} />
      {t ? (
        <>
          <HeaderIcon label="Share profile" onPress={() => Share.share({ message: `${t.name} on imo: ${API_URL}/trader/${t.handle}` })}>
            <ExportIcon size={18} weight="bold" color={color.text} />
          </HeaderIcon>
          <HeaderIcon label="More" onPress={() => setMenu("more")}>
            <DotsThreeIcon size={20} weight="bold" color={color.text} />
          </HeaderIcon>
        </>
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
        <View style={styles.pad} accessibilityLabel="Loading the profile" accessibilityRole="progressbar">
          <View style={styles.who}>
            <Skeleton width={72} height={72} round />
            <View style={styles.whoText}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="40%" height={10} />
            </View>
          </View>
          <Skeleton width="80%" height={10} style={{ marginTop: 14 }} />
          <Skeleton height={44} round style={{ marginTop: 16 }} />
        </View>
      </View>
    );

  const first = t.name.split(" ")[0];
  const stat30 = t.stats["30D"];
  const all = t.stats.All;
  const rightPct = all.resolved ? Math.round((all.correct / all.resolved) * 100) : null;
  const minSample = board.data?.minSample;
  const theirRooms = (rooms.data?.items ?? []).filter((r) => t.roomIds.includes(r.id));

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}>
        <View style={styles.pad}>
          <View style={styles.who}>
            <Avatar url={t.avatarUrl} size={72} />
            <View style={styles.whoText}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {t.name}
                </Text>
                {t.rank30 ? (
                  <View style={styles.rank} accessible accessibilityLabel={`Number ${t.rank30} on the 30-day board`}>
                    <Text style={styles.rankText}>#{t.rank30}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {[`@${t.handle}`, t.focus].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
          {t.bio ? <Text style={styles.bio}>{t.bio}</Text> : null}
          <View style={styles.counts}>
            <Text style={styles.meta}>
              <Text style={styles.strong}>{count(t.followers)}</Text> followers
            </Text>
            <Text style={styles.meta}>
              <Text style={styles.strong}>{count(t.following)}</Text> following
            </Text>
          </View>
          {mutual.length ? (
            <View style={styles.mutual}>
              <View style={styles.faces}>
                {mutual.slice(0, 3).map((p, i) => (
                  <View key={p.id} style={[styles.face, { marginLeft: i ? -6 : 0 }]}>
                    <Avatar url={p.avatarUrl} size={20} />
                  </View>
                ))}
              </View>
              <Text style={styles.mutualText} numberOfLines={1}>
                Followed by {mutual.slice(0, 2).map((p) => p.name.split(" ")[0]).join(" and ")}
                {mutual.length > 2 ? ` and ${mutual.length - 2} more you follow` : ""}
              </Text>
            </View>
          ) : null}

          {!t.isYou ? (
            <View style={styles.actions}>
              <Button
                size="md"
                variant={isFollowing && !pending ? "surface" : "primary"}
                label={pending && isFollowing ? "Following…" : isFollowing ? "Following" : "Follow"}
                onPress={toggleFollow}
                disabled={pending}
                style={styles.follow}
                accessibilityLabel={`${isFollowing ? "Unfollow" : "Follow"} ${t.name}`}
              />
              <Pressable
                onPress={toggleBell}
                style={({ pressed }) => [styles.bell, isNotified && styles.bellOn, pressed && styles.bellPressed]}
                accessibilityRole="switch"
                accessibilityState={{ checked: isNotified }}
                accessibilityLabel={`Notify me when ${first} posts`}
              >
                <BellSimpleIcon size={17} weight={isNotified ? "fill" : "bold"} color={isNotified ? color.pos : color.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <StatGrid>
          <Stat label="30D P&L" first>
            <StatValue value={compact(stat30.pnlCents)} tone={stat30.pnlCents < 0 ? "loss" : "gain"} />
          </Stat>
          <Stat label="Called right">
            <StatValue value={rightPct !== null ? `${rightPct}%` : "—"} tail={`of ${count(all.resolved)}`} />
          </Stat>
          <Stat label={`Last ${last5.length || 5}`}>
            <RecordDots results={last5} label={`Last ${last5.length}`} />
          </Stat>
        </StatGrid>

        <ChipTabs options={TABS} value={tab} onChange={setTab} style={styles.tabs} />

        {tab === "calls" ? (
          posts.isPending ? (
            <RowsSkeleton />
          ) : calls.length ? (
            calls.map(({ p, m, resolved, outcome, right, move, result }) => (
              <CallRow
                key={p.id}
                dot={right === false ? "bad" : "good"}
                title={m?.shortTitle || m?.title || p.marketId}
                meta={`${resolved ? `Resolved ${outcome ?? "void"}` : "Open"} · ${when(p.at, now)}`}
                onPress={() => router.push(`/post/${p.id}`)}
                aside={<SideChip outcome={p.outcome} label={`${p.outcome} ${price(p.entryPrice)}`} />}
                asideSub={
                  result !== null ? (
                    <Sub tone={result < 0 ? "loss" : "gain"}>{compact(result)}</Sub>
                  ) : right !== null ? (
                    <Sub tone={right ? "gain" : "loss"}>{right ? "Right" : "Wrong"}</Sub>
                  ) : move !== null ? (
                    <Sub tone="neutral">
                      {move >= 0 ? "+" : "−"}
                      {Math.abs(move)}¢ now
                    </Sub>
                  ) : null
                }
              />
            ))
          ) : (
            <Notice title="No calls yet" body={`When ${first} shares a take, it shows here.`} />
          )
        ) : tab === "open" ? (
          t.openPositionsHidden ? (
            <View style={styles.private}>
              <EyeSlashIcon size={22} weight="fill" color={color.neutral800} />
              <Text style={styles.privateTitle}>{first} keeps open positions private</Text>
              <Text style={styles.privateBody}>
                Predictions and resolved results are still public.
                {minSample !== undefined && all.resolved < minSample && rightPct !== null
                  ? ` Only ${all.resolved} resolved — treat the ${rightPct}% accuracy with care.`
                  : ""}
              </Text>
            </View>
          ) : open.length ? (
            open.map((h) => {
              const m = marketOf.get(h.marketId);
              const bid = m ? bestBid(m, h.outcome) : null;
              const pnl = bid !== null ? (bid - h.entryPrice) * h.shares : null;
              return (
                <CallRow
                  key={`${h.marketId}:${h.outcome}`}
                  title={m?.shortTitle || m?.title || h.marketId}
                  meta={`${h.shares.toLocaleString("en-US")} ${h.outcome} at ${price(h.entryPrice)}${bid !== null ? ` · now ${price(bid)}` : ""}`}
                  onPress={() => router.push(`/market/${h.marketId}`)}
                  aside={pnl !== null ? <Figure tone={pnl < 0 ? "loss" : "gain"}>{signedUsd(Math.round(pnl))}</Figure> : null}
                />
              );
            })
          ) : (
            <Notice title="Nothing open" body="No positions right now." />
          )
        ) : rooms.isPending ? (
          <RowsSkeleton />
        ) : theirRooms.length ? (
          theirRooms.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.push(`/room/${r.id}`)}
              style={({ pressed }) => [styles.room, pressed && { backgroundColor: "rgba(255, 255, 255, 0.03)" }]}
              accessibilityRole="link"
            >
              <RoomTile id={r.id} symbol={r.symbol} color={r.color} avatarUrl={r.avatarUrl} size={36} muted={!r.role} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.roomName}>{r.name}</Text>
                <Text style={styles.small}>
                  {r.memberCount.toLocaleString("en-US")} members{r.role ? " · you're in" : ""}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Notice title="No rooms" body="Not in any rooms you can see yet." />
        )}
      </ScrollView>

      {/* One sheet: "Report" swaps its actions for the reasons (both updates land together). */}
      <ActionSheet
        open={menu !== "none"}
        onClose={() => setMenu("none")}
        title={menu === "report" ? `Why are you reporting @${t.handle}?` : undefined}
        actions={menu === "report" ? REASONS.map((r) => ({ label: r.label, onPress: () => report(r.id) })) : [
          {
            label: "Share profile",
            icon: <ExportIcon size={20} color={color.text} />,
            onPress: () => Share.share({ message: `${t.name} on imo: ${API_URL}/trader/${t.handle}` }),
          },
          {
            label: "Copy link",
            icon: <LinkSimpleIcon size={20} color={color.text} />,
            onPress: () => Clipboard.setStringAsync(`${API_URL}/trader/${t.handle}`),
          },
          ...(!t.isYou
            ? [
                {
                  label: `Report @${t.handle}`,
                  icon: <FlagIcon size={20} color={color.neg} />,
                  destructive: true,
                  onPress: () => setMenu("report"),
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}

function RowsSkeleton() {
  return (
    <View style={styles.rowsSkeleton} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ gap: 6 }}>
          <Skeleton width="75%" height={13} />
          <Skeleton width="45%" height={10} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, paddingLeft: 8, paddingRight: 12 },
  pad: { paddingHorizontal: 20, paddingTop: 4 },
  who: { flexDirection: "row", alignItems: "center", gap: 16 },
  whoText: { flex: 1, gap: 4, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, fontFamily: font.medium, fontSize: 24, letterSpacing: -0.48, color: color.text },
  rank: { height: 20, paddingHorizontal: 7, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.gold200 },
  rankText: { fontFamily: font.semibold, fontSize: 11, color: color.gold, fontVariant: ["tabular-nums"] },
  meta: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.muted, fontVariant: ["tabular-nums"] },
  small: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  strong: { fontFamily: font.medium, color: color.text },
  bio: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.neutral800, marginTop: 12 },
  counts: { flexDirection: "row", gap: 16, marginTop: 12 },
  mutual: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  mutualText: { flex: 1, fontFamily: font.regular, fontSize: 12, color: color.muted },
  faces: { flexDirection: "row" },
  face: { borderRadius: 12, borderWidth: 2, borderColor: color.bg },
  actions: { flexDirection: "row", gap: 8, marginTop: 16 },
  follow: { flex: 1 },
  bell: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  bellOn: { borderColor: color.posLine, backgroundColor: "#15211a" },
  bellPressed: { opacity: 0.8 },
  tabs: { paddingTop: 16, paddingBottom: 6 },
  room: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  roomName: { fontFamily: font.medium, fontSize: 14, color: color.text },
  private: {
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 18,
    backgroundColor: color.card,
  },
  privateTitle: { fontFamily: font.medium, fontSize: 15, color: color.text, textAlign: "center", marginTop: 4 },
  privateBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.muted, textAlign: "center" },
  rowsSkeleton: { paddingHorizontal: 20, paddingTop: 12, gap: 22 },
});
