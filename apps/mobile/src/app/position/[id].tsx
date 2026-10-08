/**
 * One position: what you hold and what it's worth at the bid, where you
 * bought against where it last traded on a 0–100¢ line, what it pays if right,
 * what selling now gets, every fill, and Buy more / Sell.
 */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUpRightIcon } from "phosphor-react-native/src/icons/ArrowUpRight";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import type { MarketDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { VenueBadge } from "~/components/venue-badge";
import { Notice } from "~/features/home/notice";
import { ClaimView } from "~/features/portfolio/claim-view";
import { SellSheet } from "~/features/trade/sell-sheet";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { api } from "~/lib/api";
import { price, usd } from "~/lib/format";
import { priceFor, type Outcome } from "~/lib/market";
import { color, font, space } from "~/theme/tokens";
import { useCanTrade } from "~/features/trade/use-tradable";

interface PositionView {
  position: {
    id: string;
    marketId: string;
    outcome: Outcome;
    shares: number;
    costCents: number;
    feeCents: number;
    valueCents: number;
    bidCents: number;
    unrealizedCents: number;
    fills: { id: string; at: string; side: "Buy" | "Sell"; shares: number; priceCents: number; feeCents: number }[];
  } | null;
  claim: { payoutCents: number } | null;
}

export default function PositionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const canTrade = useCanTrade();
  const [buying, setBuying] = useState<Outcome | null>(null);
  const [selling, setSelling] = useState(false);
  const slug = id.split(":")[0]!;

  const view = useQuery({ queryKey: ["position", id], queryFn: ({ signal }) => api<PositionView>(`/positions/${encodeURIComponent(id)}`, { signal }) });
  const market = useQuery({ queryKey: ["market", slug], queryFn: ({ signal }) => api<MarketDTO>(`/markets/${slug}`, { signal }) });
  const p = view.data?.position;
  const m = market.data;


  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={4}
        style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <CaretLeftIcon size={20} weight="bold" color={color.text} />
      </Pressable>
      {m ? (
        <View style={styles.crumb}>
          <VenueBadge venueId={m.venueId} size={16} textStyle={styles.crumbText} />
          <Text style={styles.crumbText}>· {m.status}</Text>
        </View>
      ) : (
        <View style={styles.crumb}>
          <Skeleton width={110} height={12} />
        </View>
      )}
      <Pressable onPress={() => router.push(`/market/${slug}`)} hitSlop={8} style={styles.marketLink} accessibilityRole="link" accessibilityLabel="Open the market">
        <Text style={styles.marketLinkText}>Market</Text>
        <ArrowUpRightIcon size={12} weight="bold" color="#c6cec6" />
      </Pressable>
    </View>
  );

  if (view.isError)
    return (
      <View style={styles.screen}>
        {header}
        <Notice title="This position didn't load" body={view.error.message} action={{ label: "Try again", onPress: () => view.refetch() }} />
      </View>
    );
  if (market.isError)
    return (
      <View style={styles.screen}>
        {header}
        <Notice title="This market didn't load" body={market.error.message} action={{ label: "Try again", onPress: () => market.refetch() }} />
      </View>
    );
  if (!view.data || !m)
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.pad} accessibilityLabel="Loading the position" accessibilityRole="progressbar">
          <Skeleton height={14} style={{ marginTop: 10 }} />
          <Skeleton width="60%" height={14} style={{ marginTop: 8 }} />
          <Skeleton width={110} height={11} style={{ marginTop: 22 }} />
          <Skeleton width={190} height={38} style={{ marginTop: 10 }} />
          <Skeleton width={170} height={12} style={{ marginTop: 12 }} />
          <Skeleton height={8} round style={{ marginTop: 56 }} />
          <View style={[styles.cases, { marginHorizontal: 0, marginTop: 40 }]}>
            <View style={[styles.case, styles.caseFirst]}>
              <Skeleton width={70} height={10} />
              <Skeleton width={96} height={18} />
            </View>
            <View style={styles.case}>
              <Skeleton width={70} height={10} />
              <Skeleton width={96} height={18} />
            </View>
          </View>
        </View>
      </View>
    );
  if (!p)
    return (
      <View style={styles.screen}>
        {header}
        <Notice
          title="You don't hold this anymore"
          body="It was sold or settled. Its result is in Portfolio → Closed."
          action={{ label: "See closed positions", onPress: () => router.navigate("/(tabs)/portfolio?list=closed") }}
        />
      </View>
    );

  // Settled and won: the claim is the whole story now.
  if (view.data.claim)
    return (
      <ClaimView
        positionId={p.id}
        market={m}
        outcome={p.outcome}
        shares={p.shares}
        costCents={p.costCents}
        feeCents={p.feeCents}
        payoutCents={view.data.claim.payoutCents}
      />
    );

  const avg = Math.round((p.costCents / p.shares) * 10) / 10;
  const paid = p.costCents + p.feeCents;
  const change = p.valueCents - paid;
  const pct = paid ? (change / paid) * 100 : 0;
  // Buy more and Sell only where an order can actually go through.
  const open = canTrade(m);
  const tint = change < 0 ? color.neg : color.gain;
  // Where the market last traded for your side; selling gets the bid.
  const now = priceFor(m, p.outcome);

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: (open ? 120 : 24) + insets.bottom }}>
        <View style={styles.pad}>
          <Text style={styles.title}>{m.title}</Text>
          <Text style={[styles.small, { marginTop: 18 }]}>
            You hold{" "}
            <Text style={{ color: p.outcome === "Yes" ? color.gain : color.neg }}>
              {p.shares.toLocaleString("en-US")} {p.outcome}
            </Text>
          </Text>
          <Text style={styles.value} accessibilityLabel={`Worth ${usd(p.valueCents)}`}>
            {usd(p.valueCents)}
          </Text>
          <Text style={[styles.change, { color: change === 0 ? color.muted : tint }]}>
            {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
            {usd(Math.abs(change))} · {Math.abs(pct).toFixed(0)}%<Text style={styles.small}> since you bought</Text>
          </Text>

          <PriceLine paid={avg} now={now} outcome={p.outcome} />
        </View>

        <View style={styles.cases}>
          <View style={[styles.case, styles.caseFirst]}>
            <Text style={styles.small}>If {p.outcome}, pays</Text>
            <Text style={[styles.caseValue, { color: color.gain }]}>{usd(p.shares * 100)}</Text>
          </View>
          <View style={styles.case}>
            <Text style={styles.small}>{open ? "Sell now for" : "Worth now"}</Text>
            <Text style={styles.caseValue}>{usd(p.valueCents)}</Text>
          </View>
        </View>

        <View style={[styles.pad, { marginTop: 6 }]}>
          <Row label={p.feeCents ? `Cost incl. ${usd(p.feeCents)} fees` : "Cost"} value={usd(paid)} />
          <Row label="Best bid" value={price(p.bidCents)} />

          {p.fills.length ? (
            <>
              <Text style={[styles.small, styles.history]}>History</Text>
              {p.fills.map((f) => (
                <View key={f.id} style={styles.fill}>
                  <View style={[styles.dot, { backgroundColor: f.side === "Buy" ? color.gain : color.neg }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.fillText}>
                      {f.side === "Buy" ? "Bought" : "Sold"} {f.shares.toLocaleString("en-US")} at {price(f.priceCents)}
                    </Text>
                    <Text style={styles.date}>{new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                  </View>
                  <Text style={styles.fillText}>{usd(f.shares * f.priceCents + (f.side === "Buy" ? f.feeCents : -f.feeCents))}</Text>
                </View>
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>

      {open ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[3]) + 4 }]}>
          <View style={styles.fade} pointerEvents="none" />
          <Button size="lg" variant="outline" onPress={() => setBuying(p.outcome)} style={[styles.flex, styles.buyMore]} accessibilityLabel={`Buy more ${p.outcome}`}>
            <Text style={styles.buyMoreText}>Buy more</Text>
          </Button>
          <Button size="lg" onPress={() => setSelling(true)} style={styles.flex} accessibilityLabel={`Sell at ${price(p.bidCents)}`}>
            <Text style={styles.sellText}>Sell</Text>
            <Text style={[styles.sellText, { opacity: 0.55 }]}>·</Text>
            <Text style={styles.sellText}>{price(p.bidCents)}</Text>
          </Button>
        </View>
      ) : null}

      <TradeSheet post={null} market={m} outcome={buying} onClose={() => setBuying(null)} />
      <SellSheet
        open={selling}
        marketId={slug}
        title={m.shortTitle || m.title}
        outcome={p.outcome}
        shares={p.shares}
        costCents={paid}
        onClose={() => setSelling(false)}
        onSold={() => setSelling(false)}
      />
    </View>
  );
}

/** 0¢ to 100¢: where you paid and where it last traded, the stretch between in your result's color. */
function PriceLine({ paid, now, outcome }: { paid: number; now: number; outcome: Outcome }) {
  const lo = Math.min(paid, now);
  const hi = Math.max(paid, now);
  const up = now >= paid;
  const tint = up ? color.gain : color.neg;
  return (
    <View style={styles.line} accessible accessibilityLabel={`Paid ${price(paid)}, now ${price(now)}`}>
      {/* The lower price's label ends at its mark, the higher one's starts at its mark: close prices never collide. */}
      <View style={styles.lineLabels}>
        <Text style={[styles.lineTag, up ? { right: `${100 - paid}%`, paddingRight: 6 } : { left: `${paid}%`, paddingLeft: 6 }]}>
          paid {price(paid)}
        </Text>
        <Text
          style={[
            styles.lineTag,
            styles.lineNow,
            { color: tint },
            up ? { left: `${now}%`, paddingLeft: 6 } : { right: `${100 - now}%`, paddingRight: 6 },
          ]}
        >
          now {price(now)}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.base, { width: `${lo}%` }]} />
        <View
          style={[
            styles.span,
            {
              left: `${lo}%`,
              width: `${hi - lo}%`,
              backgroundColor: tint,
              boxShadow: `0 0 12px ${up ? "rgba(111, 211, 143, 0.5)" : "rgba(228, 153, 140, 0.45)"}`,
            },
          ]}
        />
        <View style={[styles.knob, { left: `${now}%`, backgroundColor: tint }]} />
      </View>
      <View style={styles.ends}>
        <Text style={styles.end}>0¢</Text>
        <Text style={styles.end}>pays $1 if {outcome}</Text>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const HAIRLINE = "rgba(255, 255, 255, 0.08)";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, paddingLeft: space[2], paddingRight: space[3] },
  headerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerIconPressed: { backgroundColor: color.card },
  crumb: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  crumbText: { fontFamily: font.regular, fontSize: 12, color: color.muted },
  marketLink: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 },
  marketLinkText: { fontFamily: font.regular, fontSize: 13, color: "#c6cec6" },
  pad: { paddingHorizontal: 20 },
  title: { fontFamily: font.regular, fontSize: 15, lineHeight: 20, color: "#c6cec6", marginTop: 6 },
  small: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  value: { fontFamily: font.medium, fontSize: 44, lineHeight: 48, letterSpacing: -1.54, color: color.text, fontVariant: ["tabular-nums"], marginTop: 4 },
  change: { fontFamily: font.regular, fontSize: 13, fontVariant: ["tabular-nums"], marginTop: space[2] },
  line: { marginTop: 26 },
  lineLabels: { height: 30 },
  lineTag: { position: "absolute", top: 8, fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  lineNow: { fontFamily: font.medium },
  track: { height: 8, borderRadius: 4, backgroundColor: HAIRLINE, justifyContent: "center" },
  /** 0¢ up to the lower of paid and now: the ground already covered. */
  base: { position: "absolute", left: 0, height: 8, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: "rgba(255, 255, 255, 0.18)" },
  span: { position: "absolute", height: 8 },
  knob: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 3, borderColor: color.bg },
  ends: { flexDirection: "row", justifyContent: "space-between", marginTop: space[2] },
  end: { fontFamily: font.regular, fontSize: 11, color: "#5b6460", fontVariant: ["tabular-nums"] },
  cases: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 22,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: HAIRLINE,
  },
  case: { flex: 1, gap: 3, paddingVertical: 14, paddingLeft: space[4] },
  caseFirst: { paddingLeft: 0, borderRightWidth: 1, borderRightColor: HAIRLINE },
  caseValue: { fontFamily: font.medium, fontSize: 20, color: color.text, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  rowLabel: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  rowValue: { fontFamily: font.regular, fontSize: 13, color: color.text, fontVariant: ["tabular-nums"] },
  history: { marginTop: 18 },
  fill: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fillText: { fontFamily: font.regular, fontSize: 13, color: color.text, fontVariant: ["tabular-nums"] },
  date: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    backgroundColor: color.bg,
  },
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -28,
    height: 28,
    experimental_backgroundImage: "linear-gradient(180deg, rgba(9, 13, 11, 0), #090d0b)",
  },
  flex: { flex: 1 },
  buyMore: { backgroundColor: color.card, borderColor: "rgba(255, 255, 255, 0.12)" },
  buyMoreText: { fontFamily: font.medium, fontSize: 15, color: color.text },
  sellText: { fontFamily: font.semibold, fontSize: 15, color: PRIMARY_INK, fontVariant: ["tabular-nums"] },
});
