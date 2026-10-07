/**
 * One position: what you hold and what it's worth at the bid, where you
 * bought against where it is now on a 0–100¢ line, what it pays if right,
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
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { VenueBadge } from "~/components/venue-badge";
import { Notice } from "~/features/home/notice";
import { ClaimView } from "~/features/portfolio/claim-view";
import { SellSheet } from "~/features/trade/sell-sheet";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { api } from "~/lib/api";
import { price, usd } from "~/lib/format";
import type { Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";

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
  const [buying, setBuying] = useState<Outcome | null>(null);
  const [selling, setSelling] = useState(false);
  const slug = id.split(":")[0]!;

  const view = useQuery({ queryKey: ["position", id], queryFn: ({ signal }) => api<PositionView>(`/positions/${encodeURIComponent(id)}`, { signal }) });
  const market = useQuery({ queryKey: ["market", slug], queryFn: ({ signal }) => api<MarketDTO>(`/markets/${slug}`, { signal }) });
  const p = view.data?.position;
  const m = market.data;


  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel="Back">
        <CaretLeftIcon size={22} weight="bold" color={color.text} />
      </Pressable>
      {m ? (
        <View style={styles.crumb}>
          <VenueBadge venueId={m.venueId} size={18} textStyle={styles.crumbText} />
          <Text style={styles.crumbText}>· {m.status}</Text>
        </View>
      ) : (
        <View style={styles.crumb} />
      )}
      <Pressable onPress={() => router.push(`/market/${slug}`)} hitSlop={8} style={styles.marketLink} accessibilityRole="link">
        <Text style={styles.marketLinkText}>Market</Text>
        <ArrowUpRightIcon size={14} color={color.text} />
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
  if (!view.data || !m)
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.pad} accessibilityLabel="Loading the position" accessibilityRole="progressbar">
          <Skeleton height={18} />
          <Skeleton width={120} height={12} />
          <Skeleton width={200} height={44} />
          <Skeleton height={60} style={{ borderRadius: radius.card }} />
        </View>
      </View>
    );
  if (!p)
    return (
      <View style={styles.screen}>
        {header}
        <Notice title="You don't hold this anymore" body="It was sold or settled. Its result is in Portfolio → Closed." />
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
  const open = m.status === "open";
  const tint = change < 0 ? color.neg : color.pos;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View style={styles.pad}>
          <Text style={styles.title}>{m.title}</Text>
          <Text style={styles.small}>
            You hold{" "}
            <Text style={{ color: p.outcome === "Yes" ? color.pos : color.neg }}>
              {p.shares.toLocaleString("en-US")} {p.outcome}
            </Text>
          </Text>
          <Text style={styles.value}>{usd(p.valueCents)}</Text>
          <Text style={[styles.change, { color: tint }]}>
            {change >= 0 ? "▲" : "▼"} {usd(Math.abs(change))} · {Math.abs(pct).toFixed(0)}% <Text style={styles.small}>since you bought</Text>
          </Text>

          <PriceLine paid={avg} now={p.bidCents} outcome={p.outcome} />
        </View>

        <View style={styles.cases}>
          <View style={[styles.case, styles.caseFirst]}>
            <Text style={styles.small}>If {p.outcome}, pays</Text>
            <Text style={[styles.caseValue, { color: color.pos }]}>{usd(p.shares * 100)}</Text>
          </View>
          <View style={styles.case}>
            <Text style={styles.small}>{open ? "Sell now for" : "Worth now"}</Text>
            <Text style={styles.caseValue}>{usd(p.valueCents)}</Text>
          </View>
        </View>

        <View style={styles.pad}>
          <Row label={`Cost incl. ${usd(p.feeCents)} fees`} value={usd(paid)} />
          <Row label="Best bid" value={price(p.bidCents)} />

          <Text style={[styles.small, styles.history]}>History</Text>
          {p.fills.map((f) => (
            <View key={f.id} style={styles.fill}>
              <View style={[styles.dot, { backgroundColor: f.side === "Buy" ? color.pos : color.neg }]} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.fillText}>
                  {f.side === "Buy" ? "Bought" : "Sold"} {f.shares.toLocaleString("en-US")} at {price(f.priceCents)}
                </Text>
                <Text style={styles.small}>{new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
              </View>
              <Text style={styles.fillText}>{usd(f.shares * f.priceCents + (f.side === "Buy" ? f.feeCents : -f.feeCents))}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {open ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <Button size="lg" variant="outline" label="Buy more" onPress={() => setBuying(p.outcome)} style={styles.flex} />
          <Button size="lg" label={`Sell · ${price(p.bidCents)}`} onPress={() => setSelling(true)} style={styles.flex} />
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

/** 0¢ to 100¢, where you paid and where the bid is now, the stretch between in your result's color. */
function PriceLine({ paid, now, outcome }: { paid: number; now: number; outcome: Outcome }) {
  const lo = Math.min(paid, now);
  const hi = Math.max(paid, now);
  const up = now >= paid;
  return (
    <View style={styles.line} accessible accessibilityLabel={`Paid ${price(paid)}, now ${price(now)}`}>
      {/* The lower price's label ends at its mark, the higher one's starts at its mark: close prices never collide. */}
      <View style={styles.lineLabels}>
        <Text style={[styles.lineTag, up ? { right: `${100 - paid}%`, paddingRight: 8 } : { left: `${paid}%`, paddingLeft: 8 }]}>
          paid {price(paid)}
        </Text>
        <Text
          style={[
            styles.lineTag,
            styles.lineNow,
            { color: up ? color.pos : color.neg },
            up ? { left: `${now}%`, paddingLeft: 8 } : { right: `${100 - now}%`, paddingRight: 8 },
          ]}
        >
          now {price(now)}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.base, { width: `${lo}%` }]} />
        <View style={[styles.span, { left: `${lo}%`, width: `${hi - lo}%`, backgroundColor: up ? color.pos : color.neg }]} />
        <View style={[styles.knob, { left: `${now}%`, backgroundColor: up ? color.pos : color.neg }]} />
      </View>
      <View style={styles.ends}>
        <Text style={styles.small}>0¢</Text>
        <Text style={styles.small}>pays $1 if {outcome}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingBottom: space[2] },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  crumb: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  crumbText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  marketLink: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: space[1] },
  marketLinkText: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  pad: { paddingHorizontal: space[4], gap: space[2] },
  title: { fontFamily: font.regular, fontSize: 19, lineHeight: 26, color: color.text, marginTop: space[3], marginBottom: space[3] },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700, fontVariant: ["tabular-nums"] },
  value: { fontFamily: font.medium, fontSize: 44, letterSpacing: -1.4, color: color.text, fontVariant: ["tabular-nums"] },
  change: { fontFamily: font.medium, fontSize: text.body, fontVariant: ["tabular-nums"] },
  line: { marginTop: space[6], gap: space[2] },
  lineLabels: { height: 16 },
  lineTag: { position: "absolute", fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  lineNow: { fontFamily: font.medium },
  track: { height: 6, borderRadius: 3, backgroundColor: color.neutral400, justifyContent: "center" },
  /** 0¢ up to the lower of paid and now: the ground already covered. */
  base: { position: "absolute", left: 0, height: 6, borderRadius: 3, backgroundColor: color.neutral600 },
  span: { position: "absolute", height: 6, borderRadius: 3, opacity: 0.85 },
  knob: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: color.bg },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  cases: {
    flexDirection: "row",
    marginHorizontal: space[4],
    marginVertical: space[5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  case: { flex: 1, gap: 6, paddingVertical: space[4], paddingLeft: space[4] },
  caseFirst: { paddingLeft: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.neutral400 },
  caseValue: { fontFamily: font.medium, fontSize: 22, color: color.text, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  rowLabel: { fontFamily: font.regular, fontSize: text.body, color: color.neutral800 },
  rowValue: { fontFamily: font.regular, fontSize: text.body, color: color.text, fontVariant: ["tabular-nums"] },
  history: { marginTop: space[4] },
  fill: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  fillText: { fontFamily: font.regular, fontSize: text.body, color: color.text, fontVariant: ["tabular-nums"] },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    backgroundColor: "rgba(9, 13, 11, 0.94)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  flex: { flex: 1 },
});
