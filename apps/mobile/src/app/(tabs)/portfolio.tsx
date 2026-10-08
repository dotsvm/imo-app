/**
 * Portfolio: what you hold and how it's done — with real money, your
 * wallet's USDC plus your positions; on a paper server, the demo account —
 * results waiting to be claimed, and four lists: open positions, orders,
 * closed positions, and every money movement.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
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
import { ChartPieSliceIcon } from "phosphor-react-native/src/icons/ChartPieSlice";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { CircleDashedIcon } from "phosphor-react-native/src/icons/CircleDashed";
import { ClockIcon } from "phosphor-react-native/src/icons/Clock";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";
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
import { tabBarSpace } from "~/components/tab-bar";
import { useMe } from "~/features/auth/use-account";
import { Notice } from "~/features/home/notice";
import { TrendLine } from "~/features/markets/trend-line";
import { AddFundsSheet } from "~/features/wallet/add-funds-sheet";
import { claimWithWallet } from "~/features/wallet/orders";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { price, signedUsd, usd } from "~/lib/format";
import { color, font, radius, space } from "~/theme/tokens";

type List = "open" | "orders" | "closed" | "activity";
const LISTS: List[] = ["open", "orders", "closed", "activity"];
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
type Activity = ActivityDTO["items"][number];

const HAIRLINE = "rgba(255, 255, 255, 0.08)";
const LOSS = "#ec8b78";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const tintOf = (cents: number) => (cents < 0 ? LOSS : cents > 0 ? color.gain : color.muted);

export default function Portfolio() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe().data;
  // A link can open a list ("/(tabs)/portfolio?list=closed", from a claim).
  const params = useLocalSearchParams<{ list?: string }>();
  const asked = LISTS.find((l) => l === params.list);
  const [list, setList] = useState<List>(asked ?? "open");
  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== lastAsked) {
    setLastAsked(asked);
    if (asked) setList(asked);
  }
  const [claiming, setClaiming] = useState(false);
  const trading = useTrading();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

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
  /** The market's short name; null while it's still loading (a skeleton, never the raw slug). */
  const title = (slug: string) => {
    const m: MarketDTO | undefined = marketOf.get(slug);
    if (m) return m.shortTitle || m.title;
    return markets.isPending ? null : slug;
  };

  async function claimAll() {
    if (!p) return;
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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

  async function cancel(o: Order) {
    setCancelling(o.id);
    setProblem(null);
    try {
      await api(`/orders/${o.id}/cancel`, { body: {} });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't cancel that order. Try again.");
    } finally {
      setCancelling(null);
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
  const firstTitle = firstClaim ? title(firstClaim.marketId) : null;
  const realized = (p?.closed ?? []).reduce((s, c) => s + c.pnlCents, 0);
  const pad = { paddingBottom: tabBarSpace(insets.bottom) + space[5] };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[{ paddingTop: insets.top + space[3] }, pad]}
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
          <Text style={styles.label13}>Portfolio</Text>
          {trading.live ? (
            <Pressable onPress={() => router.push("/wallet")} style={[styles.badge, styles.badgeLive]} accessibilityRole="button" accessibilityLabel="Open your wallet">
              <Text style={[styles.badgeText, { color: color.pos }]}>USDC · Solana</Text>
            </Pressable>
          ) : (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Demo funds</Text>
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
            <Text style={[styles.change, { color: tintOf(gain) }]}>
              {gain > 0 ? "▲ " : gain < 0 ? "▼ " : ""}
              {usd(Math.abs(gain))} · {Math.abs(p.account.returnPct).toFixed(2)}%
              <Text style={styles.muted}> all time</Text>
            </Text>
          </>
        ) : (
          <View accessibilityLabel="Loading your portfolio" accessibilityRole="progressbar">
            <Skeleton width="60%" height={34} style={{ marginTop: 14 }} />
            <Skeleton width="45%" height={10} style={{ marginTop: 14 }} />
          </View>
        )}
      </View>

      {curve.length > 1 ? (
        <View style={styles.curve}>
          <TrendLine points={curve} height={46} stroke={color.gain} wash={0.2} />
        </View>
      ) : null}

      {trading.live ? (
        <View style={styles.moneyRow}>
          <Button
            size="ml"
            label="Deposit"
            onPress={() => setAdding(true)}
            icon={<PlusIcon size={14} weight="bold" color={PRIMARY_INK} />}
            style={styles.money}
          />
          <Button
            size="ml"
            variant="outline"
            onPress={() => router.push("/withdraw")}
            icon={<ArrowUpRightIcon size={14} weight="bold" color={color.text} />}
            style={[styles.money, styles.withdraw]}
            accessibilityLabel="Withdraw"
          >
            <Text style={styles.withdrawText}>Withdraw</Text>
          </Button>
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
            tint={p.account.unrealizedCents ? tintOf(p.account.unrealizedCents) : undefined}
          />
        </View>
      ) : (
        <View style={styles.split}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flex: 1, gap: 8 }}>
              <Skeleton width={56} height={9} />
              <Skeleton width={80} height={13} />
            </View>
          ))}
        </View>
      )}

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
              <CheckIcon size={16} weight="bold" color={PRIMARY_INK} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.claimTitle}>
                {usd(claimTotal)} ready to claim
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {p.claims.length === 1
                  ? `${firstTitle ?? "Your market"} won${
                      claimPosition.data?.position
                        ? ` · ${signedUsd(firstClaim.payoutCents - claimPosition.data.position.costCents - claimPosition.data.position.feeCents)} profit`
                        : ""
                    }`
                  : `${p.claims.length} winning positions`}
              </Text>
            </View>
          </Pressable>
          <Button
            size="xs"
            label="Claim"
            onPress={claimAll}
            loading={claiming}
            style={styles.claimButton}
            accessibilityLabel={`Claim ${usd(claimTotal)}`}
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
              onPress={() => {
                if (!on) Haptics.selectionAsync().catch(() => {});
                setList(id);
              }}
              style={[styles.listTab, on && styles.listTabOn]}
              accessibilityRole="tab"
              accessibilityLabel={n !== undefined ? `${label}, ${n}` : label}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.listText, on && styles.listTextOn]}>
                {label}
              </Text>
              {n !== undefined ? (
                <Text style={[styles.listText, styles.count, on && styles.listTextOn]}>{n}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {!p ? (
        <RowsSkeleton />
      ) : list === "open" ? (
        p.positions.length ? (
          p.positions.map((x) => {
            const name = title(x.marketId);
            return (
              <Pressable
                key={x.id}
                onPress={() =>
                  router.push(`/position/${encodeURIComponent(x.id)}`)
                }
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${name ?? "Position"}, ${x.shares} ${x.outcome}, worth ${usd(x.valueCents)}, ${signedUsd(x.unrealizedCents)}`}
              >
                <View style={styles.rowLine}>
                  {name ? (
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {name}
                    </Text>
                  ) : (
                    <Skeleton width="55%" height={13} />
                  )}
                  <Text style={styles.rowValue}>{usd(x.valueCents)}</Text>
                </View>
                <View style={styles.rowLine}>
                  <View style={styles.rowMeta}>
                    <Side outcome={x.outcome} />
                    <Text style={styles.meta}>
                      {x.shares.toLocaleString("en-US")} at{" "}
                      {price(Math.round((x.costCents / x.shares) * 10) / 10)}
                    </Text>
                  </View>
                  <Text style={[styles.pnl, { color: x.unrealizedCents < 0 ? LOSS : x.unrealizedCents > 0 ? color.pos : color.muted }]}>
                    {signedUsd(x.unrealizedCents)}
                  </Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <Empty
            icon={<ChartPieSliceIcon size={24} weight="fill" color={color.muted} />}
            title="No positions yet"
            body={`Pick a market, buy Yes or No, and it shows up here.${
              p.account.kind === "paper" ? ` You have ${usd(p.account.availableCents)} in simulated funds.` : ""
            }`}
            action="Browse markets"
            onPress={() => router.navigate("/(tabs)/discover")}
          />
        )
      ) : list === "orders" ? (
        orders.isPending ? (
          <RowsSkeleton />
        ) : orders.isError ? (
          <Notice title="Orders didn't load" body={orders.error.message} action={{ label: "Try again", onPress: () => orders.refetch() }} />
        ) : orders.data.items.length ? (
          orders.data.items.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              title={title(o.quote.marketId)}
              cancelling={cancelling === o.id}
              onCancel={o.resting ? () => cancel(o) : undefined}
            />
          ))
        ) : (
          <Empty
            icon={<ClockIcon size={24} weight="fill" color={color.muted} />}
            title="No orders yet"
            body="Orders you place show up here, filled or waiting."
          />
        )
      ) : list === "closed" ? (
        p.closed.length ? (
          <>
            {p.closed.map((c) => {
              const name = title(c.marketId);
              return (
                <View key={c.id} style={styles.row} accessible accessibilityLabel={`${name ?? "Closed position"}, realized ${signedUsd(c.pnlCents)}`}>
                  <View style={styles.rowLine}>
                    {name ? (
                      <Text style={[styles.rowTitle, styles.medium]} numberOfLines={1}>
                        {name}
                      </Text>
                    ) : (
                      <Skeleton width="55%" height={13} />
                    )}
                    <Text style={[styles.rowValue, { color: tintOf(c.pnlCents) }]}>
                      {c.pnlCents > 0 ? "▲ " : c.pnlCents < 0 ? "▼ " : ""}
                      {usd(c.pnlCents)}
                    </Text>
                  </View>
                  <View style={styles.rowLine}>
                    <Text style={[styles.meta, { flex: 1 }]} numberOfLines={1}>
                      {c.shares.toLocaleString("en-US")} {c.outcome} · in {price(Math.round((c.costCents / c.shares) * 10) / 10)} → out{" "}
                      {price(Math.round((c.proceedsCents / c.shares) * 10) / 10)} · {day(c.closedAt)}
                    </Text>
                    <Text style={styles.meta}>realized</Text>
                  </View>
                </View>
              );
            })}
            <View style={styles.footRow}>
              <Text style={styles.footLabel}>Realized P&amp;L</Text>
              <Text style={[styles.rowValue, { color: tintOf(realized) }]}>{signedUsd(realized)}</Text>
            </View>
          </>
        ) : (
          <Empty
            icon={<FlagIcon size={24} weight="fill" color={color.muted} />}
            title="Nothing closed yet"
            body="Positions you sell or that resolve land here with their result."
          />
        )
      ) : activity.isPending ? (
        <RowsSkeleton />
      ) : activity.isError ? (
        <Notice title="Activity didn't load" body={activity.error.message} action={{ label: "Try again", onPress: () => activity.refetch() }} />
      ) : activity.data.items.length ? (
        activity.data.items.map((a) => <ActivityRow key={a.id} item={a} />)
      ) : (
        <Empty
          icon={<ClockIcon size={24} weight="fill" color={color.muted} />}
          title="No activity yet"
          body="Every buy, sale and payout shows up here as it happens."
        />
      )}
    </ScrollView>
  );
}

function Figure({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={[styles.figure, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

function Side({ outcome }: { outcome: "Yes" | "No" }) {
  const yes = outcome === "Yes";
  return (
    <View style={[styles.side, { backgroundColor: yes ? "rgba(181, 230, 161, 0.13)" : "rgba(239, 138, 109, 0.13)" }]}>
      <Text style={[styles.sideText, { color: yes ? color.pos : "#f59c83" }]}>{outcome}</Text>
    </View>
  );
}

const ORDER_TAG: Record<string, { label: string; ink: string; bg: string }> = {
  pending: { label: "Pending", ink: "#c9cfcb", bg: "rgba(255, 255, 255, 0.08)" },
  partial: { label: "Partially filled", ink: "#c9cfcb", bg: "rgba(255, 255, 255, 0.08)" },
  filled: { label: "Filled", ink: color.gain, bg: "rgba(111, 211, 143, 0.12)" },
  cancelled: { label: "Cancelled", ink: color.muted, bg: "rgba(255, 255, 255, 0.05)" },
  failed: { label: "Failed", ink: "#f59c83", bg: "rgba(239, 138, 109, 0.13)" },
};

function OrderRow({ order: o, title, onCancel, cancelling }: { order: Order; title: string | null; onCancel?: () => void; cancelling: boolean }) {
  const tag = ORDER_TAG[o.status] ?? { label: o.status, ink: "#c9cfcb", bg: "rgba(255, 255, 255, 0.08)" };
  const filled = o.filledShares > 0 && o.filledShares < o.quote.shares ? ` · ${o.filledShares.toLocaleString("en-US")} filled` : "";
  return (
    <View style={styles.row}>
      <View style={styles.rowLine}>
        {title ? (
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          <Skeleton width="55%" height={13} />
        )}
        <Text style={styles.rowValue}>{usd(o.filledShares > 0 ? o.filledTotalCents : o.quote.totalCents)}</Text>
      </View>
      <View style={styles.rowLine}>
        <View style={[styles.rowMeta, { flex: 1 }]}>
          <Side outcome={o.quote.outcome} />
          <Text style={styles.meta} numberOfLines={1}>
            {o.quote.side} {o.quote.shares.toLocaleString("en-US")} at {price(o.limitCents ?? o.quote.priceCents)}
            {o.type === "limit" ? " limit" : ""}
            {filled} · {day(o.at)}
          </Text>
        </View>
        <View style={[styles.tag, { backgroundColor: tag.bg }]}>
          <Text style={[styles.tagText, { color: tag.ink }]}>{tag.label}</Text>
        </View>
      </View>
      {o.status === "failed" && o.reason ? <Text style={styles.reason}>{o.reason}</Text> : null}
      {onCancel ? (
        <Button
          size="xs"
          variant="quiet"
          label={o.status === "partial" ? "Cancel rest" : "Cancel"}
          onPress={onCancel}
          loading={cancelling}
          style={styles.cancel}
          accessibilityLabel={`Cancel the order on ${title ?? "this market"}`}
        />
      ) : null}
    </View>
  );
}

function ActivityRow({ item: a }: { item: Activity }) {
  const icon = (() => {
    if (a.title.startsWith("Order failed")) return <XCircleIcon size={20} weight="fill" color="#f59c83" />;
    if (a.title.startsWith("Partial fill")) return <CircleDashedIcon size={20} weight="fill" color="#c9cfcb" />;
    if (a.title.startsWith("Paper account funded")) return <ChartPieSliceIcon size={20} weight="fill" color={color.muted} />;
    switch (a.kind) {
      case "buy":
        return <CheckCircleIcon size={20} weight="fill" color={color.gain} />;
      case "sell":
        return <ArrowUpRightIcon size={20} weight="bold" color="#c9cfcb" />;
      case "claim":
        return <FlagIcon size={20} weight="fill" color={color.gain} />;
      default:
        return <ClockIcon size={20} weight="fill" color={color.muted} />;
    }
  })();
  return (
    <View style={[styles.row, styles.activity]} accessible accessibilityLabel={`${a.title}. ${a.detail}${a.amountCents ? `. ${signedUsd(a.amountCents)}` : ""}`}>
      <View style={styles.activityIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {a.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {a.detail}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 3 }}>
        {a.amountCents ? (
          <Text style={[styles.rowValue, { color: a.amountCents > 0 ? color.gain : color.text }]}>{signedUsd(a.amountCents)}</Text>
        ) : null}
        <Text style={styles.meta}>{day(a.at)}</Text>
      </View>
    </View>
  );
}

/** An empty list: a glyph, what's missing, and (when there's a next step) the primary way forward. */
function Empty({ icon, title, body, action, onPress }: { icon: ReactNode; title: string; body: string; action?: string; onPress?: () => void }) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && onPress ? <Button size="sm" label={action} onPress={onPress} style={{ marginTop: space[2] }} /> : null}
    </View>
  );
}

function RowsSkeleton() {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rowLine}>
            <Skeleton width="55%" height={13} />
            <Skeleton width={64} height={13} />
          </View>
          <View style={styles.rowLine}>
            <Skeleton width={110} height={14} round />
            <Skeleton width={48} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pad: { paddingHorizontal: 20 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label13: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  muted: { color: color.muted },
  meta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.muted,
    fontVariant: ["tabular-nums"],
  },
  badge: {
    height: 24,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(226, 200, 146, 0.35)",
  },
  badgeLive: { borderColor: color.posLine },
  badgeText: { fontFamily: font.regular, fontSize: 11, color: color.gold },
  total: {
    fontFamily: font.medium,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.54,
    color: color.text,
    fontVariant: ["tabular-nums"],
    marginTop: 10,
  },
  totalCents: { color: color.muted },
  change: {
    fontFamily: font.regular,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    marginTop: space[2],
  },
  curve: { paddingHorizontal: 20, marginTop: 14 },
  moneyRow: { flexDirection: "row", gap: space[2], paddingHorizontal: 20, marginTop: space[4] },
  money: { flex: 1, height: 44 },
  withdraw: { backgroundColor: color.card, borderColor: "rgba(255, 255, 255, 0.1)" },
  withdrawText: { fontFamily: font.medium, fontSize: 14, color: color.text },
  split: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  figure: {
    fontFamily: font.medium,
    fontSize: 15,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginHorizontal: space[4],
    marginTop: 18,
    paddingVertical: space[3],
    paddingLeft: 14,
    paddingRight: space[3],
    borderRadius: 18,
    backgroundColor: "rgba(111, 211, 143, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(111, 211, 143, 0.22)",
  },
  claimOpen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  // The primary key's look, as a mark (not a button).
  claimCheck: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    experimental_backgroundImage: "linear-gradient(180deg, #c3edb1, #a7dd92)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(20,60,30,0.28), 0 6px 14px -4px rgba(0,0,0,0.55)",
  },
  claimTitle: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  claimButton: { height: 32, paddingHorizontal: 14 },
  problem: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.neg,
    paddingHorizontal: 20,
    marginTop: space[2],
  },
  listRow: { flexGrow: 0, marginTop: 18 },
  lists: {
    gap: 6,
    paddingHorizontal: space[4],
    paddingBottom: 10,
  },
  listTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 32,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: color.card,
  },
  listTabOn: { backgroundColor: color.text },
  listText: { fontFamily: font.regular, fontSize: 13, color: "#c6cec6" },
  listTextOn: { color: "#0c100e" },
  count: { fontSize: 11, opacity: 0.55, fontVariant: ["tabular-nums"] },
  row: { gap: 3, paddingHorizontal: 20, paddingVertical: 11 },
  rowLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  pressed: { backgroundColor: color.neutral100 },
  rowTitle: { flexShrink: 1, fontFamily: font.regular, fontSize: 14, lineHeight: 18, color: color.text },
  medium: { fontFamily: font.medium },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.text,
    fontVariant: ["tabular-nums"],
  },
  pnl: { fontFamily: font.regular, fontSize: 12, fontVariant: ["tabular-nums"] },
  side: { height: 18, paddingHorizontal: 7, justifyContent: "center", borderRadius: radius.pill },
  sideText: { fontFamily: font.medium, fontSize: 10 },
  tag: { height: 20, paddingHorizontal: 8, justifyContent: "center", borderRadius: radius.pill },
  tagText: { fontFamily: font.medium, fontSize: 11 },
  reason: { fontFamily: font.regular, fontSize: 11, color: "#f59c83" },
  cancel: { alignSelf: "flex-start", marginTop: 6 },
  footRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 20,
    marginTop: space[1],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  footLabel: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  activity: { flexDirection: "row", alignItems: "center", gap: space[3] },
  activityIcon: { width: 20, alignItems: "center" },
  empty: { alignItems: "center", gap: space[2], paddingHorizontal: space[6], paddingTop: space[6] },
  emptyTitle: { fontFamily: font.medium, fontSize: 18, color: color.text, textAlign: "center", marginTop: space[1] },
  emptyBody: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.muted, textAlign: "center" },
});
