/**
 * Your profile: who you are, your all-time result and how often you've been
 * right, then three lists — your calls (closed and settled positions, with
 * how each ended), what you hold now, and your posts.
 */
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { GearSixIcon } from "phosphor-react-native/src/icons/GearSix";
import type { FeedPage, MarketPage, PortfolioDTO, TraderDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { ChipTabs } from "~/components/chip-tabs";
import { CallRow, Figure, RecordDots, Stat, StatGrid, StatValue, Sub } from "~/components/profile-parts";
import { HeaderIcon } from "~/components/screen-header";
import { Skeleton } from "~/components/skeleton";
import { tabBarSpace } from "~/components/tab-bar";
import { useConfig } from "~/features/auth/auth";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { api, API_URL } from "~/lib/api";
import { count, price, signedUsd, usd } from "~/lib/format";
import { color, font, radius } from "~/theme/tokens";

type Tab = "calls" | "positions" | "posts";
const TABS = [
  { id: "calls", label: "Calls" },
  { id: "positions", label: "Positions" },
  // "Backed" in the design: there's no list of the posts you backed yet, so your own posts.
  { id: "posts", label: "Posts" },
] as const;

interface Call {
  id: string;
  marketId: string;
  outcome: "Yes" | "No";
  pnlCents: number;
  /** "Resolved Yes", "Sold at 30¢", "Resolved Yes · to claim" */
  how: string;
  verdict: "Right" | "Wrong" | null;
}

/** "Sep ’26" */
const joined = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short" })} ’${String(d.getFullYear()).slice(2)}`;
};

export default function Profile() {
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const config = useConfig().data;
  const demo = config?.profile === "demo" && config.trading !== "wallet";
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
      return { id: c.id, marketId: c.marketId, outcome: c.outcome, pnlCents: NaN, how: `Resolved ${res ?? c.outcome} · to claim`, verdict: "Right" };
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
      };
    }),
  ];
  const good = (c: Call) => (c.verdict ? c.verdict === "Right" : c.pnlCents >= 0);
  const all = trader.data?.stats.All;
  // Your own all-time result is the account itself (what Portfolio shows), not the stats job's last run.
  // Real money: what trading made (no starting balance of ours to count from).
  const allTime = p
    ? p.account.kind === "wallet"
      ? p.closed.reduce((sum, c) => sum + c.pnlCents, 0) + p.account.unrealizedCents
      : p.account.totalCents - p.account.startingBalanceCents
    : all?.pnlCents;
  const dots = calls.slice(0, 5).map(good);

  const refresh = () => {
    trader.refetch();
    portfolio.refetch();
    if (tab === "posts") posts.refetch();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: tabBarSpace(insets.bottom) + 24 }}
      refreshControl={<RefreshControl refreshing={trader.isRefetching} onRefresh={refresh} tintColor={color.neutral600} />}
    >
      <View style={styles.top}>
        <Text style={styles.handle}>{handle ? `@${handle}` : " "}</Text>
        <View style={styles.tools}>
          <HeaderIcon
            label="Share profile"
            onPress={() => handle && Share.share({ message: `${me?.user.displayName} on imo: ${API_URL}/trader/${handle}` })}
          >
            <ExportIcon size={18} weight="bold" color={color.text} />
          </HeaderIcon>
          <HeaderIcon label="Settings" onPress={() => router.push("/settings")}>
            <GearSixIcon size={19} weight="fill" color={color.text} />
          </HeaderIcon>
        </View>
      </View>

      {me ? (
        <View style={styles.pad}>
          <View style={styles.who}>
            <Avatar url={me.user.avatarUrl} size={72} />
            <View style={styles.whoText}>
              <Text style={styles.name} numberOfLines={1}>
                {me.user.displayName}
              </Text>
              <Text style={styles.meta}>{[me.user.focus, `joined ${joined(me.user.joinedAt)}`].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
          <View style={styles.follows}>
            <Text style={styles.meta}>
              <Text style={styles.strong}>{trader.data ? count(trader.data.followers) : "—"}</Text> followers
            </Text>
            <Text style={styles.meta}>
              <Text style={styles.strong}>{trader.data ? count(trader.data.following) : "—"}</Text> following
            </Text>
            {demo ? (
              <View style={styles.demo} accessible accessibilityLabel="Demo account">
                <Text style={styles.demoText}>Demo</Text>
              </View>
            ) : null}
          </View>
          {me.user.bio ? <Text style={styles.bio}>{me.user.bio}</Text> : null}
          <Button variant="surface" size="md" label="Edit profile" onPress={() => router.push("/edit-profile")} style={styles.edit} labelStyle={styles.editLabel} />
        </View>
      ) : (
        <View style={styles.pad} accessibilityLabel="Loading your profile" accessibilityRole="progressbar">
          <View style={styles.who}>
            <Skeleton width={72} height={72} round />
            <View style={styles.whoText}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="40%" height={10} />
            </View>
          </View>
          <Skeleton width="80%" height={10} style={{ marginTop: 14 }} />
          <Skeleton height={40} round style={{ marginTop: 14 }} />
        </View>
      )}

      <StatGrid>
        <Stat label="All-time" first>
          <StatValue value={allTime !== undefined ? signedUsd(allTime) : "—"} tone={allTime === undefined ? undefined : allTime < 0 ? "loss" : "gain"} />
        </Stat>
        <Stat label="Called right">
          <StatValue value={all ? String(all.correct) : "—"} tail={`of ${all ? count(all.resolved) : "—"}`} />
        </Stat>
        <Stat label="Record">
          <RecordDots results={dots} label={`Last ${dots.length}`} />
        </Stat>
      </StatGrid>

      <ChipTabs options={TABS} value={tab} onChange={setTab} style={styles.tabs} />

      {tab === "calls" ? (
        portfolio.isPending ? (
          <RowsSkeleton />
        ) : calls.length ? (
          calls.map((c) => (
            <CallRow
              key={c.id}
              dot={good(c) ? "good" : "bad"}
              title={titleOf(c.marketId)}
              meta={`Called ${c.outcome} · ${c.how}`}
              onPress={() => router.push(`/market/${c.marketId}`)}
              aside={Number.isFinite(c.pnlCents) ? <Figure tone={c.pnlCents < 0 ? "loss" : "gain"}>{signedUsd(c.pnlCents)}</Figure> : null}
              asideSub={c.verdict ? <Sub tone={c.verdict === "Right" ? "gain" : "loss"}>{c.verdict}</Sub> : null}
            />
          ))
        ) : (
          <Notice title="No calls closed yet" body="When a position resolves or you sell it, it lands here with how it ended." />
        )
      ) : tab === "positions" ? (
        portfolio.isPending ? (
          <RowsSkeleton />
        ) : p?.positions.length ? (
          p.positions.map((x) => (
            <CallRow
              key={x.id}
              title={titleOf(x.marketId)}
              meta={`${x.shares.toLocaleString("en-US")} ${x.outcome} at ${price(Math.round((x.costCents / x.shares) * 10) / 10)}`}
              onPress={() => router.push(`/position/${encodeURIComponent(x.id)}`)}
              aside={<Figure>{usd(x.valueCents)}</Figure>}
              asideSub={<Sub tone={x.unrealizedCents < 0 ? "loss" : "gain"}>{signedUsd(x.unrealizedCents)}</Sub>}
            />
          ))
        ) : (
          <Notice title="Nothing open" body="Positions you hold show here." />
        )
      ) : posts.isPending ? (
        <RowsSkeleton />
      ) : posts.data?.items.length ? (
        posts.data.items.map((post) => (
          <CallRow
            key={post.id}
            title={post.text}
            meta={`Called ${post.outcome} at ${price(post.entryPrice)} · ${post.likes} likes · ${post.commentCount} replies`}
            onPress={() => router.push(`/post/${post.id}`)}
          />
        ))
      ) : (
        <Notice title="No posts yet" body="Share your take on a market; it shows here with your position." />
      )}
      {trader.isError ? <Text style={[styles.meta, styles.error]}>Your record didn’t load. Pull to retry.</Text> : null}
    </ScrollView>
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
  top: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 12 },
  handle: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  tools: { flexDirection: "row", gap: 4 },
  pad: { paddingHorizontal: 20, paddingTop: 4 },
  who: { flexDirection: "row", alignItems: "center", gap: 16 },
  whoText: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontFamily: font.medium, fontSize: 24, letterSpacing: -0.48, color: color.text },
  meta: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.muted, fontVariant: ["tabular-nums"] },
  strong: { fontFamily: font.medium, color: color.text },
  follows: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 14 },
  demo: {
    marginLeft: "auto",
    height: 22,
    paddingHorizontal: 9,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(226, 200, 146, 0.35)",
  },
  demoText: { fontFamily: font.regular, fontSize: 11, color: color.gold },
  bio: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.neutral800, marginTop: 12 },
  edit: { height: 40, marginTop: 14 },
  editLabel: { fontFamily: font.regular, fontSize: 14 },
  tabs: { paddingTop: 16, paddingBottom: 6 },
  rowsSkeleton: { paddingHorizontal: 20, paddingTop: 12, gap: 22 },
  error: { paddingHorizontal: 20, marginTop: 12 },
});
