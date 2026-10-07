/**
 * Portfolio: what you hold and how it's done — with real money, your
 * wallet's USDC plus your positions; on a paper server, the demo account —
 * results waiting to be claimed, and four lists: open positions, orders,
 * closed positions, and every money movement.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUpRightIcon } from "phosphor-react-native/src/icons/ArrowUpRight";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type {
  ActivityDTO,
  MarketDTO,
  MarketPage,
  OrderDTO,
  PortfolioDTO,
  TraderDTO,
} from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { TAB_BAR_HEIGHT } from "~/components/tab-bar";
import { useMe } from "~/features/auth/use-account";
import { PriceChart } from "~/features/market/price-chart";
import { Notice } from "~/features/home/notice";
import { AddFundsSheet } from "~/features/wallet/add-funds-sheet";
import { claimWithWallet } from "~/features/wallet/orders";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { ago, price, signedUsd, usd } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type List = "open" | "orders" | "closed" | "activity";
/** An order with the quote it was placed on (stored as JSON, so typed here). */
type Order = Omit<OrderDTO, "quote"> & {
  quote: {
    marketId: string;
    side: "Buy" | "Sell";
    outcome: "Yes" | "No";
    shares: number;
    priceCents: number;
    totalCents: number;
  };
};

export default function Portfolio() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const [list, setList] = useState<List>("open");
  const [claiming, setClaiming] = useState(false);
  const trading = useTrading();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }),
  });
  const orders = useQuery({
    queryKey: ["portfolio", "orders"],
    queryFn: ({ signal }) => api<{ items: Order[] }>("/orders", { signal }),
  });
  const activity = useQuery({
    queryKey: ["portfolio", "activity"],
    queryFn: ({ signal }) =>
      api<ActivityDTO>("/portfolio/activity", { signal }),
    enabled: list === "activity",
  });
  // What the first winning position cost, for its profit line.
  const claimPosition = useQuery({
    queryKey: ["position", portfolio.data?.claims[0]?.positionId],
    queryFn: ({ signal }) =>
      api<{ position: { costCents: number; feeCents: number } | null }>(
        `/positions/${encodeURIComponent(portfolio.data!.claims[0]!.positionId)}`,
        { signal },
      ),
    enabled: !!portfolio.data?.claims.length,
  });
  const trader = useQuery({
    queryKey: ["trader", me?.user.handle],
    queryFn: ({ signal }) =>
      api<TraderDTO>(`/traders/${me!.user.handle}`, { signal }),
    enabled: !!me,
  });

  const p = portfolio.data;
  const slugs = [
    ...new Set(
      [...(p?.positions ?? []), ...(p?.closed ?? []), ...(p?.claims ?? [])]
        .map((x) => x.marketId)
        .concat((orders.data?.items ?? []).map((o) => o.quote.marketId)),
    ),
  ];
  const markets = useQuery({
    queryKey: ["markets", "byIds", slugs.join(",")],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { ids: slugs.join(","), limit: Math.min(100, slugs.length) },
        signal,
      }),
    enabled: slugs.length > 0,
  });
  const marketOf = new Map((markets.data?.items ?? []).map((m) => [m.id, m]));
  const title = (slug: string) => {
    const m: MarketDTO | undefined = marketOf.get(slug);
    return m ? m.shortTitle || m.title : slug;
  };

  async function claimAll() {
    if (!p) return;
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still connecting. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setClaiming(true);
    setProblem(null);
    try {
      for (const c of p.claims)
        if (trading.live && trading.wallet.status === "ready")
          await claimWithWallet(encodeURIComponent(c.positionId), trading.wallet.sign, () => {});
        else
          await api(`/positions/${encodeURIComponent(c.positionId)}/claim`, {
            method: "POST",
          });
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Couldn't claim. Try again.",
      );
    } finally {
      setClaiming(false);
    }
  }

  const refresh = () => {
    portfolio.refetch();
    orders.refetch();
    if (list === "activity") activity.refetch();
  };

  if (portfolio.isError)
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Notice
          title="Your portfolio didn't load"
          body={portfolio.error.message}
          action={{ label: "Try again", onPress: refresh }}
        />
      </View>
    );

  // The fullest line the stats job has drawn; early on that's just start and now.
  const curves = trader.data?.curves;
  const curve = [curves?.["30D"], curves?.["90D"], curves?.All].reduce<number[]>((best, c) => (c && c.length > best.length ? c : best), []);
  // Real money has no starting balance of ours: the gain is what trading made.
  const gain = p
    ? trading.live
      ? p.closed.reduce((s, c) => s + c.pnlCents, 0) + p.account.unrealizedCents
      : p.account.totalCents - p.account.startingBalanceCents
    : 0;
  const [dollars, cents] = p ? usd(p.account.totalCents).split(".") : ["", ""];
  const claimTotal = (p?.claims ?? []).reduce((s, c) => s + c.payoutCents, 0);
  const firstClaim = p?.claims[0];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + space[3],
        paddingBottom:
          TAB_BAR_HEIGHT + Math.max(insets.bottom, space[3]) + space[5],
      }}
      refreshControl={
        <RefreshControl
          refreshing={portfolio.isRefetching}
          onRefresh={refresh}
          tintColor={color.neutral600}
        />
      }
    >
      <View style={styles.pad}>
        <View style={styles.top}>
          <Text style={styles.small}>Portfolio</Text>
          {trading.live ? (
            <Pressable onPress={() => router.push("/wallet")} style={styles.demo} accessibilityRole="button" accessibilityLabel="Open your wallet">
              <Text style={[styles.demoText, { color: color.pos }]}>USDC · Solana</Text>
            </Pressable>
          ) : (
            <View style={styles.demo}>
              <Text style={styles.demoText}>Demo funds</Text>
            </View>
          )}
        </View>
        {p ? (
          <>
            <Text
              style={styles.total}
              accessibilityLabel={`Total ${usd(p.account.totalCents)}`}
            >
              {dollars}
              <Text style={styles.totalCents}>.{cents}</Text>
            </Text>
            <Text
              style={[
                styles.change,
                {
                  color:
                    gain < 0
                      ? color.neg
                      : gain > 0
                        ? color.pos
                        : color.neutral700,
                },
              ]}
            >
              {gain > 0 ? "▲ " : gain < 0 ? "▼ " : ""}
              {usd(Math.abs(gain))} · {Math.abs(p.account.returnPct).toFixed(2)}
              % <Text style={styles.small}>all time</Text>
            </Text>
          </>
        ) : (
          <View style={{ gap: 8 }}>
            <Skeleton width={220} height={44} />
            <Skeleton width={160} height={13} />
          </View>
        )}
      </View>

      {curve.length > 1 ? (
        <View style={styles.curve}>
          <PriceChart points={curve} height={64} />
        </View>
      ) : null}

      {trading.live ? (
        <View style={styles.moneyRow}>
          <Button
            label="Deposit"
            onPress={() => setAdding(true)}
            icon={<PlusIcon size={15} weight="bold" color={PRIMARY_INK} />}
            style={{ flex: 1 }}
          />
          <Button
            variant="outline"
            label="Withdraw"
            onPress={() => router.push("/withdraw")}
            icon={<ArrowUpRightIcon size={15} weight="bold" color={color.text} />}
            style={{ flex: 1 }}
          />
        </View>
      ) : null}
      <AddFundsSheet open={adding} onClose={() => setAdding(false)} />

      {p ? (
        <View style={styles.split}>
          <Figure
            label={trading.live ? "In wallet" : "Cash"}
            value={p.account.cashKnown ? usd(p.account.availableCents) : "—"}
          />
          <Figure
            label="In positions"
            value={usd(p.account.positionsValueCents)}
          />
          <Figure
            label="Open P&L"
            value={signedUsd(p.account.unrealizedCents)}
            tint={
              p.account.unrealizedCents < 0
                ? color.neg
                : p.account.unrealizedCents > 0
                  ? color.pos
                  : undefined
            }
          />
        </View>
      ) : null}

      {p && firstClaim ? (
        <View style={styles.claim}>
          {/* The words open the win; Claim beside them claims it. Two controls, not one inside the other. */}
          <Pressable
            onPress={() =>
              router.push(
                `/position/${encodeURIComponent(firstClaim.positionId)}`,
              )
            }
            style={styles.claimOpen}
            accessibilityRole="button"
            accessibilityHint="Opens the winning position"
          >
            <View style={styles.claimCheck}>
              <CheckIcon size={18} weight="bold" color={PRIMARY_INK} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.claimTitle}>
                {usd(claimTotal)} ready to claim
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {p.claims.length === 1
                  ? `${title(firstClaim.marketId)} won${
                      claimPosition.data?.position
                        ? ` · ${signedUsd(firstClaim.payoutCents - claimPosition.data.position.costCents - claimPosition.data.position.feeCents)} profit`
                        : ""
                    }`
                  : `${p.claims.length} winning positions`}
              </Text>
            </View>
          </Pressable>
          <Button
            size="sm"
            label="Claim"
            onPress={claimAll}
            loading={claiming}
          />
        </View>
      ) : null}
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.lists}
        style={styles.listRow}
      >
        {(
          [
            ["open", "Open", p?.positions.length],
            ["orders", "Orders", orders.data?.items.length],
            ["closed", "Closed", p?.closed.length],
            ["activity", "Activity", undefined],
          ] as const
        ).map(([id, label, n]) => {
          const on = id === list;
          return (
            <Pressable
              key={id}
              onPress={() => setList(id)}
              style={[styles.listTab, on && styles.listTabOn]}
              accessibilityRole="tab"
              accessibilityLabel={n !== undefined ? `${label}, ${n}` : label}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.listText, on && styles.listTextOn]}>
                {label}
              </Text>
              {n !== undefined ? (
                <Text style={[styles.count, on && styles.listTextOn]}>{n}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {!p ? (
        <View style={styles.pad}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={44} style={{ marginTop: space[3] }} />
          ))}
        </View>
      ) : list === "open" ? (
        p.positions.length ? (
          p.positions.map((x) => (
            <Pressable
              key={x.id}
              onPress={() =>
                router.push(`/position/${encodeURIComponent(x.id)}`)
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {title(x.marketId)}
                </Text>
                <View style={styles.rowMeta}>
                  <Side outcome={x.outcome} />
                  <Text style={styles.small}>
                    {x.shares.toLocaleString("en-US")} at{" "}
                    {price(Math.round((x.costCents / x.shares) * 10) / 10)}
                  </Text>
                </View>
              </View>
              <View style={styles.rowFigure}>
                <Text style={styles.rowValue}>{usd(x.valueCents)}</Text>
                <Text
                  style={[
                    styles.small,
                    { color: x.unrealizedCents < 0 ? color.neg : color.pos },
                  ]}
                >
                  {signedUsd(x.unrealizedCents)}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Notice
            title="No open positions"
            body="Back a take or buy a side in Discover; it shows up here."
          />
        )
      ) : list === "orders" ? (
        orders.data?.items.length ? (
          orders.data.items.map((o) => (
            <View key={o.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {title(o.quote.marketId)}
                </Text>
                <View style={styles.rowMeta}>
                  <Side outcome={o.quote.outcome} />
                  <Text style={styles.small}>
                    {o.quote.side} {o.quote.shares.toLocaleString("en-US")} at{" "}
                    {price(o.quote.priceCents)} · {ago(o.at)}
                  </Text>
                </View>
              </View>
              <View style={styles.rowFigure}>
                <Text style={styles.rowValue}>{usd(o.quote.totalCents)}</Text>
                <Text style={styles.small}>{o.status.replace("_", " ")}</Text>
              </View>
            </View>
          ))
        ) : (
          <Notice
            title="No orders yet"
            body="Orders you place show up here, filled or waiting."
          />
        )
      ) : list === "closed" ? (
        p.closed.length ? (
          p.closed.map((c) => (
            <View key={c.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {title(c.marketId)}
                </Text>
                <View style={styles.rowMeta}>
                  <Side outcome={c.outcome} />
                  <Text style={styles.small}>
                    {c.shares.toLocaleString("en-US")} · {c.kind} ·{" "}
                    {ago(c.closedAt)}
                  </Text>
                </View>
              </View>
              <View style={styles.rowFigure}>
                <Text
                  style={[
                    styles.rowValue,
                    { color: c.pnlCents < 0 ? color.neg : color.pos },
                  ]}
                >
                  {signedUsd(c.pnlCents)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Notice
            title="Nothing closed yet"
            body="Positions you sell or that resolve land here with their result."
          />
        )
      ) : activity.isPending ? (
        <View style={styles.pad}>
          <Skeleton height={44} style={{ marginTop: space[3] }} />
        </View>
      ) : (
        (activity.data?.items ?? []).map((a) => (
          <View key={a.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {a.title}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {a.detail} · {ago(a.at)}
              </Text>
            </View>
            {a.amountCents ? (
              <Text
                style={[
                  styles.rowValue,
                  { color: a.amountCents > 0 ? color.pos : color.text },
                ]}
              >
                {signedUsd(a.amountCents)}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Figure({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.figure, tint ? { color: tint } : null]}>
        {value}
      </Text>
    </View>
  );
}

function Side({ outcome }: { outcome: "Yes" | "No" }) {
  const yes = outcome === "Yes";
  return (
    <View
      style={[
        styles.side,
        { backgroundColor: yes ? color.pos200 : color.neg200 },
      ]}
    >
      <Text style={[styles.sideText, { color: yes ? color.pos : color.neg }]}>
        {outcome}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pad: { paddingHorizontal: space[4], gap: space[2] },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  small: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  moneyRow: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], marginTop: space[4] },
  demo: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(226, 200, 146, 0.4)",
  },
  demoText: { fontFamily: font.medium, fontSize: 11, color: color.gold },
  total: {
    fontFamily: font.medium,
    fontSize: 46,
    letterSpacing: -1.5,
    color: color.text,
    fontVariant: ["tabular-nums"],
    marginTop: space[2],
  },
  totalCents: { color: color.neutral600 },
  change: {
    fontFamily: font.medium,
    fontSize: text.body,
    fontVariant: ["tabular-nums"],
  },
  curve: { paddingHorizontal: space[4], marginTop: space[4] },
  split: {
    flexDirection: "row",
    marginHorizontal: space[4],
    marginTop: space[4],
    paddingTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  figure: {
    fontFamily: font.medium,
    fontSize: text.post,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginHorizontal: space[4],
    marginTop: space[5],
    padding: space[3],
    borderRadius: radius.panel,
    backgroundColor: "#15211a",
    borderWidth: 1,
    borderColor: "#2f4733",
  },
  claimOpen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  claimCheck: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
  },
  claimTitle: {
    fontFamily: font.medium,
    fontSize: text.post,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  problem: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neg,
    paddingHorizontal: space[4],
    marginTop: space[2],
  },
  listRow: { flexGrow: 0, marginTop: space[5] },
  lists: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  listTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  listTabOn: { backgroundColor: "#eceadf" },
  listText: {
    fontFamily: font.medium,
    fontSize: text.body,
    color: color.neutral800,
  },
  listTextOn: { color: "#0b0d0c" },
  count: { fontFamily: font.regular, fontSize: 12, color: color.neutral600 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 12,
  },
  pressed: { backgroundColor: color.neutral100 },
  rowText: { flex: 1, gap: 6 },
  rowTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowFigure: { alignItems: "flex-end", gap: 4 },
  rowValue: {
    fontFamily: font.medium,
    fontSize: text.post,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  side: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.chip },
  sideText: { fontFamily: font.medium, fontSize: 11 },
});
