/**
 * Your profile: who you are, your all-time result and how often you've been
 * right, then three lists — your calls (closed and settled positions, with
 * how each ended), what you hold now, and your posts.
 */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { GearSixIcon } from "phosphor-react-native/src/icons/GearSix";
import type { FeedPage, MarketPage, PortfolioDTO, TraderDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { useConfig } from "~/features/auth/auth";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { api, API_URL } from "~/lib/api";
import { price, signedUsd, usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Tab = "calls" | "positions" | "posts";

interface Call {
  id: string;
  marketId: string;
  outcome: "Yes" | "No";
  pnlCents: number;
  /** "Resolved Yes", "Sold at 30¢", "Resolved Yes · to claim" */
  how: string;
  verdict: "Right" | "Wrong" | null;
  at: string;
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const demo = useConfig().data?.profile === "demo";
  const [tab, setTab] = useState<Tab>("calls");
  const handle = me?.user.handle;

  const trader = useQuery({
    queryKey: ["trader", handle],
    queryFn: ({ signal }) => api<TraderDTO>(`/traders/${handle}`, { signal }),
    enabled: !!handle,
  });
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }) });
  const posts = useQuery({
    queryKey: ["feed", "trader", handle],
    queryFn: ({ signal }) => api<FeedPage>("/posts", { query: { trader: handle, limit: 30 }, signal }),
    enabled: !!handle && tab === "posts",
  });

  const p = portfolio.data;
  const slugs = [...new Set([...(p?.closed ?? []), ...(p?.claims ?? []), ...(p?.positions ?? [])].map((x) => x.marketId))];
  const markets = useQuery({
    queryKey: ["markets", "byIds", slugs.join(",")],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { ids: slugs.join(","), limit: Math.min(100, slugs.length) }, signal }),
    enabled: slugs.length > 0,
  });
  const marketOf = new Map((markets.data?.items ?? []).map((m) => [m.id, m]));
  const titleOf = (slug: string) => marketOf.get(slug)?.title ?? slug;

  // Calls: what's closed (sold, or settled) and what's won and waiting.
  const calls: Call[] = [
    ...(p?.claims ?? []).map((c): Call => {
      const res = marketOf.get(c.marketId)?.resolution.outcome;
      return { id: c.id, marketId: c.marketId, outcome: c.outcome, pnlCents: NaN, how: `Resolved ${res ?? c.outcome} · to claim`, verdict: "Right", at: "" };
    }),
    ...(p?.closed ?? []).map((c): Call => {
      const res = marketOf.get(c.marketId)?.resolution.outcome;
      const settled = c.kind !== "sell";
      return {
        id: c.id,
        marketId: c.marketId,
        outcome: c.outcome,
        pnlCents: c.pnlCents,
        how: settled ? `Resolved ${res ?? "—"}` : `Sold at ${price(Math.round((c.proceedsCents / c.shares) * 10) / 10)}`,
        verdict: settled && res ? (res === c.outcome ? "Right" : "Wrong") : null,
        at: c.closedAt,
      };
    }),
  ];
  const all = trader.data?.stats.All;
  // Your own all-time result is the account itself (what Portfolio shows), not the stats job's last run.
  // Real money: what trading made (no starting balance of ours to count from).
  const allTime = p
    ? p.account.kind === "wallet"
      ? p.closed.reduce((sum, c) => sum + c.pnlCents, 0) + p.account.unrealizedCents
      : p.account.totalCents - p.account.startingBalanceCents
    : all?.pnlCents;
  const dots = calls.slice(0, 5).map((c) => (c.verdict ? c.verdict === "Right" : c.pnlCents >= 0));

  const refresh = () => {
    trader.refetch();
    portfolio.refetch();
    if (tab === "posts") posts.refetch();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, space[3]) + space[5] }}
      refreshControl={<RefreshControl refreshing={trader.isRefetching} onRefresh={refresh} tintColor={color.neutral600} />}
    >
      <View style={styles.top}>
        <Text style={styles.handle}>{handle ? `@${handle}` : " "}</Text>
        <View style={styles.tools}>
          <Pressable
            onPress={() => handle && Share.share({ message: `${me?.user.displayName} on imo: ${API_URL}/trader/${handle}` })}
            hitSlop={8}
            style={styles.tool}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
          >
            <ExportIcon size={21} color={color.text} />
          </Pressable>
          <Pressable onPress={() => router.push("/settings")} hitSlop={8} style={styles.tool} accessibilityRole="button" accessibilityLabel="Settings">
            <GearSixIcon size={22} weight="fill" color={color.text} />
          </Pressable>
        </View>
      </View>

      {me ? (
        <View style={styles.pad}>
          <View style={styles.who}>
            <Avatar url={me.user.avatarUrl} size={72} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name}>{me.user.displayName}</Text>
              <Text style={styles.small}>
                {[me.user.focus, `joined ${new Date(me.user.joinedAt).toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '")}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>
          <View style={styles.follows}>
            <Text style={styles.small}>
              <Text style={styles.strong}>{trader.data?.followers ?? "—"}</Text> followers{"   "}
              <Text style={styles.strong}>{trader.data?.following ?? "—"}</Text> following
            </Text>
            {demo ? (
              <View style={styles.demo}>
                <Text style={styles.demoText}>Demo</Text>
              </View>
            ) : null}
          </View>
          {me.user.bio ? <Text style={styles.bio}>{me.user.bio}</Text> : null}
          <Button variant="outline" label="Edit profile" onPress={() => router.push("/edit-profile")} />
        </View>
      ) : (
        <View style={[styles.pad, { gap: space[3] }]}>
          <Skeleton width={72} height={72} round />
          <Skeleton width={160} height={18} />
        </View>
      )}

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.small}>All-time</Text>
          <Text style={[styles.statBig, { color: (allTime ?? 0) < 0 ? color.neg : color.pos }]}>{allTime !== undefined ? signedUsd(allTime) : "—"}</Text>
        </View>
        <View style={[styles.stat, styles.statMid]}>
          <Text style={styles.small}>Called right</Text>
          <Text style={styles.statValue}>
            {all ? all.correct : "—"} <Text style={styles.small}>of {all?.resolved ?? "—"}</Text>
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.small}>Record</Text>
          <View style={styles.dots} accessible accessibilityLabel={`Last ${dots.length}: ${dots.map((d) => (d ? "right" : "wrong")).join(", ")}`}>
            {dots.length ? dots.map((d, i) => <View key={i} style={[styles.dot, { backgroundColor: d ? color.pos : color.neg }]} />) : <Text style={styles.small}>—</Text>}
          </View>
        </View>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["calls", "Calls"],
            ["positions", "Positions"],
            ["posts", "Posts"],
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
        calls.length ? (
          calls.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/market/${c.marketId}`)} style={styles.call} accessibilityRole="link">
              <View style={[styles.callDot, { backgroundColor: (c.verdict ? c.verdict === "Right" : c.pnlCents >= 0) ? color.pos : color.neg }]} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.callTitle} numberOfLines={1}>
                  {titleOf(c.marketId)}
                </Text>
                <Text style={styles.small}>
                  Called {c.outcome} · {c.how}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                {Number.isFinite(c.pnlCents) ? (
                  <Text style={[styles.callPnl, { color: c.pnlCents < 0 ? color.neg : color.pos }]}>{signedUsd(c.pnlCents)}</Text>
                ) : null}
                {c.verdict ? <Text style={[styles.small, { color: c.verdict === "Right" ? color.pos : color.neg }]}>{c.verdict}</Text> : null}
              </View>
            </Pressable>
          ))
        ) : (
          <Notice title="No calls closed yet" body="When a position resolves or you sell it, it lands here with how it ended." />
        )
      ) : tab === "positions" ? (
        p?.positions.length ? (
          p.positions.map((x) => (
            <Pressable key={x.id} onPress={() => router.push(`/position/${encodeURIComponent(x.id)}`)} style={styles.call} accessibilityRole="link">
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.callTitle} numberOfLines={1}>
                  {titleOf(x.marketId)}
                </Text>
                <Text style={styles.small}>
                  {x.shares.toLocaleString("en-US")} {x.outcome} at {price(Math.round((x.costCents / x.shares) * 10) / 10)}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={styles.callPnl}>{usd(x.valueCents)}</Text>
                <Text style={[styles.small, { color: x.unrealizedCents < 0 ? color.neg : color.pos }]}>{signedUsd(x.unrealizedCents)}</Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Notice title="Nothing open" body="Positions you hold show here." />
        )
      ) : posts.isPending ? (
        <View style={styles.pad}>
          <Skeleton height={44} />
        </View>
      ) : posts.data?.items.length ? (
        posts.data.items.map((post) => (
          <Pressable key={post.id} onPress={() => router.push(`/post/${post.id}`)} style={styles.call} accessibilityRole="link">
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.callTitle} numberOfLines={2}>
                {post.text}
              </Text>
              <Text style={styles.small}>
                Called {post.outcome} at {price(post.entryPrice)} · {post.likes} likes · {post.commentCount} replies
              </Text>
            </View>
          </Pressable>
        ))
      ) : (
        <Notice title="No posts yet" body="Share your take on a market; it shows here with your position." />
      )}
      {trader.isError ? <Text style={[styles.small, styles.pad]}>Your record didn’t load. Pull to retry.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[4], marginBottom: space[3] },
  handle: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
  tools: { flexDirection: "row", gap: space[2] },
  tool: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pad: { paddingHorizontal: space[4], gap: space[3] },
  who: { flexDirection: "row", alignItems: "center", gap: space[4] },
  name: { fontFamily: font.medium, fontSize: 26, letterSpacing: -0.6, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700, fontVariant: ["tabular-nums"] },
  strong: { fontFamily: font.semibold, color: color.text },
  follows: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  demo: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(226, 200, 146, 0.4)" },
  demoText: { fontFamily: font.medium, fontSize: 11, color: color.gold },
  bio: { fontFamily: font.regular, fontSize: text.body, lineHeight: 20, color: color.neutral800 },
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
  callTitle: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text },
  callPnl: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text, fontVariant: ["tabular-nums"] },
});
