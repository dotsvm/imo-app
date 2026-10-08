/**
 * One market: its question and prices, the Yes line over a range, the
 * numbers, and four views — Overview (your position, the top of the book,
 * how it resolves, the best of the discussion), Book, Trades, Discussion —
 * with Buy Yes / Buy No always at hand.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import type { BookDTO, CandlesDTO, FeedPage, MarketDTO, PortfolioDTO, TradesDTO, WatchlistsDTO } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { VenueBadge } from "~/components/venue-badge";
import { useConfig } from "~/features/auth/auth";
import { compactUsd } from "~/features/discover/market-row";
import { PostCard } from "~/features/feed/post-card";
import { Notice } from "~/features/home/notice";
import { PriceChart } from "~/features/market/price-chart";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { api, API_URL } from "~/lib/api";
import { price, signedUsd, usd } from "~/lib/format";
import { bestAsk, complement, type Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";

type Range = "1D" | "1W" | "1M" | "All";
type Tab = "overview" | "book" | "trades" | "discussion";
const RANGES: Range[] = ["1D", "1W", "1M", "All"];
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "book", label: "Book" },
  { id: "trades", label: "Trades" },
  { id: "discussion", label: "Discussion" },
];
const STATUS: Record<string, string> = { open: "Open", closed: "Awaiting result", resolved: "Resolved" };

export default function MarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const snapshot = useConfig().data?.dataSnapshot;
  // The clock, read once: the demo dataset's fixed moment, else when the page opened.
  const [opened] = useState(() => Date.now());
  const now = snapshot ? Date.parse(snapshot) : opened;
  const [range, setRange] = useState<Range>("1W");
  const [tab, setTab] = useState<Tab>("overview");
  const [trade, setTrade] = useState<Outcome | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const market = useQuery({ queryKey: ["market", id], queryFn: ({ signal }) => api<MarketDTO>(`/markets/${id}`, { signal }) });
  const candles = useQuery({
    queryKey: ["candles", id, range],
    queryFn: ({ signal }) => api<CandlesDTO>(`/markets/${id}/candles`, { query: { range }, signal }),
    placeholderData: (prev) => prev,
  });
  const book = useQuery({ queryKey: ["book", id], queryFn: ({ signal }) => api<BookDTO>(`/markets/${id}/book`, { signal }) });
  const trades = useQuery({
    queryKey: ["trades", id],
    queryFn: ({ signal }) => api<TradesDTO>(`/markets/${id}/trades`, { signal }),
    enabled: tab === "trades",
  });
  const posts = useQuery({ queryKey: ["feed", "market", id], queryFn: ({ signal }) => api<FeedPage>("/posts", { query: { market: id, limit: 20 }, signal }) });
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }) });
  const watchlists = useQuery({ queryKey: ["watchlists"], queryFn: ({ signal }) => api<WatchlistsDTO>("/watchlists", { signal }) });

  const m = market.data;
  const isSaved = saved ?? watchlists.data?.items.find((w) => w.isDefault)?.marketIds.includes(id) ?? false;
  const held = (portfolio.data?.positions ?? []).filter((p) => p.marketId === id);

  async function toggleSave() {
    setSaved(!isSaved);
    try {
      await api(`/watchlists/saved/markets/${id}`, { method: isSaved ? "DELETE" : "PUT", body: isSaved ? undefined : {} });
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    } catch {
      setSaved(isSaved);
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[1] }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel="Back">
        <CaretLeftIcon size={22} weight="bold" color={color.text} />
      </Pressable>
      {m ? (
        <View style={styles.crumb}>
          <VenueBadge venueId={m.venueId} size={18} textStyle={styles.crumbText} />
          <Text style={styles.crumbText}>· {m.category}</Text>
        </View>
      ) : (
        <View style={styles.crumb} />
      )}
      {m ? (
        <>
          <Pressable onPress={toggleSave} hitSlop={10} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel={isSaved ? "Remove from saved" : "Save market"}>
            <BookmarkSimpleIcon size={21} weight="fill" color={isSaved ? color.pos : color.text} />
          </Pressable>
          <Pressable
            onPress={() => Share.share({ message: `${m.title} ${API_URL}/market/${encodeURIComponent(m.id)}` })}
            hitSlop={10}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Share"
          >
            <ExportIcon size={21} color={color.text} />
          </Pressable>
        </>
      ) : null}
    </View>
  );

  if (market.isError)
    return (
      <View style={styles.screen}>
        {header}
        <Notice title="This market didn't load" body={market.error.message} action={{ label: "Try again", onPress: () => market.refetch() }} />
      </View>
    );
  if (!m)
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.pad} accessibilityLabel="Loading the market" accessibilityRole="progressbar">
          <Skeleton height={24} />
          <Skeleton width="65%" height={24} />
          <Skeleton width={180} height={12} />
          <Skeleton width={200} height={44} />
          <Skeleton height={150} style={{ borderRadius: radius.card }} />
        </View>
      </View>
    );

  const daysLeft = Math.max(0, Math.ceil((Date.parse(m.closesAt) - now) / 86_400_000));
  const closes = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const open = m.status === "open";
  const no = complement(m.yesPrice);
  const points = (candles.data?.points ?? []).map((p) => p.yes);
  const items = posts.data?.items ?? [];

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: open ? 110 + insets.bottom : insets.bottom + space[5] }}>
        <View style={styles.pad}>
          <Text style={styles.title}>{m.title}</Text>
          <Text style={styles.meta}>
            {STATUS[m.status] ?? m.status} · {open ? `closes ${closes} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : `closed ${closes}`}
          </Text>
          <View style={styles.prices}>
            <PriceBlock label="Yes" cents={m.yesPrice} change={m.change} strong />
            <PriceBlock label="No" cents={no} change={-m.change} />
          </View>
        </View>

        <View style={styles.chart}>
          {points.length > 1 ? <PriceChart points={points} /> : <Skeleton height={150} style={{ borderRadius: radius.card }} />}
        </View>
        <View style={styles.ranges}>
          {RANGES.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              style={[styles.range, r === range && styles.rangeOn]}
              accessibilityRole="tab"
              accessibilityLabel={r}
              accessibilityState={{ selected: r === range }}
            >
              <Text style={[styles.rangeText, r === range && styles.rangeTextOn]}>{r}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.stats}>
          <Stat label="Volume" value={compactUsd(m.volumeCents)} />
          <Stat label="Traders" value={m.traders.toLocaleString("en-US")} />
          <Stat label="Open int." value={compactUsd(m.openInterestCents)} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, t.id === tab && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: t.id === tab }}
            >
              <Text style={[styles.tabText, t.id === tab && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "overview" ? (
          <View style={styles.pad}>
            {held.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/position/${encodeURIComponent(p.id)}`)}
                style={({ pressed }) => [styles.position, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.small}>Your position</Text>
                  <Text style={styles.positionText}>
                    {p.shares.toLocaleString("en-US")} {p.outcome} · avg {price(Math.round((p.costCents / p.shares) * 10) / 10)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={styles.positionText}>{usd(p.valueCents)}</Text>
                  <Text style={[styles.small, { color: p.unrealizedCents < 0 ? color.neg : color.pos }]}>{signedUsd(p.unrealizedCents)}</Text>
                </View>
                <CaretRightIcon size={16} color={color.neutral600} />
              </Pressable>
            ))}

            <Section title="Order book · Yes">
              <Book book={book.data} rows={3} />
            </Section>

            <Section title="How it resolves">
              <Text style={styles.rules} numberOfLines={rulesOpen ? undefined : 4}>
                {m.resolution.rule}
                {m.resolution.source ? ` Source: ${m.resolution.source}.` : ""}
              </Text>
              <Pressable onPress={() => setRulesOpen(!rulesOpen)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>{rulesOpen ? "Show less" : "Full rules"}</Text>
              </Pressable>
            </Section>

            {items.length ? (
              <Section title="Top discussion">
                {items.slice(0, 3).map((p) => (
                  <Pressable key={p.id} onPress={() => router.push(`/post/${p.id}`)} style={styles.talk} accessibilityRole="link">
                    <Text style={styles.talkHead}>
                      {p.author.name}
                      <Text style={styles.small}>
                        {"  "}
                        {p.disclosePosition && p.evidenceShares > 0
                          ? `Holds ${p.evidenceShares.toLocaleString("en-US")} ${p.outcome}`
                          : `Called ${p.outcome}`}
                      </Text>
                    </Text>
                    <Text style={styles.talkText} numberOfLines={3}>
                      {p.text}
                    </Text>
                  </Pressable>
                ))}
              </Section>
            ) : null}
          </View>
        ) : tab === "book" ? (
          <View style={styles.pad}>
            <Book book={book.data} rows={20} />
          </View>
        ) : tab === "trades" ? (
          <View style={styles.pad}>
            {trades.isPending ? (
              <Skeleton height={120} style={{ borderRadius: radius.card }} />
            ) : (
              (trades.data?.items ?? []).map((t) => (
                <View key={t.id} style={styles.tradeRow}>
                  <Text style={[styles.tradeSide, { color: t.outcome === "Yes" ? color.pos : color.neg }]}>
                    {t.side} {t.outcome}
                  </Text>
                  <Text style={styles.tradeText}>
                    {t.shares.toLocaleString("en-US")} @ {price(t.priceCents)}
                  </Text>
                  <Text style={styles.small}>{t.minutesAgo < 60 ? `${t.minutesAgo}m` : `${Math.round(t.minutesAgo / 60)}h`}</Text>
                </View>
              ))
            )}
            {trades.isSuccess && !trades.data.items.length ? <Text style={styles.small}>No trades yet.</Text> : null}
          </View>
        ) : (
          <View>
            {items.length ? (
              items.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  market={m}
                  now={snapshot ? now : undefined}
                  onTrade={(_e, o) => setTrade(o)}
                />
              ))
            ) : (
              <Notice title="No takes on this market yet" body="Be the first to say what you think happens." />
            )}
          </View>
        )}
      </ScrollView>

      {open ? (
        <View style={[styles.buy, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <Button size="lg" label={`Buy Yes · ${price(bestAsk(m, "Yes"))}`} onPress={() => setTrade("Yes")} style={styles.buyButton} />
          <Button size="lg" variant="outline" label={`Buy No · ${price(bestAsk(m, "No"))}`} onPress={() => setTrade("No")} style={styles.buyButton} />
        </View>
      ) : null}

      <TradeSheet post={null} market={m} outcome={trade} onClose={() => setTrade(null)} />
    </View>
  );
}

function PriceBlock({ label, cents, change, strong }: { label: string; cents: number; change: number; strong?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.price, !strong && { color: color.neutral600 }]}>{price(cents)}</Text>
      <Text style={[styles.small, { color: change > 0 ? color.pos : change < 0 ? color.neg : color.neutral700 }]}>
        {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
        {Math.abs(change).toFixed(1).replace(/\.0$/, "")}¢ today
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.small}>{title}</Text>
      {children}
    </View>
  );
}

function Book({ book, rows }: { book: BookDTO | undefined; rows: number }) {
  if (!book) return <Skeleton height={80} style={{ borderRadius: radius.card }} />;
  const n = Math.min(rows, Math.max(book.bids.length, book.asks.length));
  if (!n) return <Text style={styles.small}>No resting orders right now.</Text>;
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.bookRow}>
        <Text style={[styles.small, styles.bookCell]}>Bids</Text>
        <Text style={[styles.small, styles.bookCell]}>Asks</Text>
      </View>
      {Array.from({ length: n }, (_, i) => {
        const b = book.bids[i];
        const a = book.asks[i];
        return (
          <View key={i} style={styles.bookRow}>
            <View style={styles.bookCell}>
              {b ? (
                <>
                  <Text style={[styles.bookPrice, { color: color.pos }]}>{price(b.priceCents)}</Text>
                  <Text style={styles.bookSize}>{Math.round(b.shares).toLocaleString("en-US")}</Text>
                </>
              ) : null}
            </View>
            <View style={styles.bookCell}>
              {a ? (
                <>
                  <Text style={[styles.bookPrice, { color: color.neg }]}>{price(a.priceCents)}</Text>
                  <Text style={styles.bookSize}>{Math.round(a.shares).toLocaleString("en-US")}</Text>
                </>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingBottom: space[2] },
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  crumb: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  crumbText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  pad: { paddingHorizontal: space[4], gap: space[3] },
  title: { fontFamily: font.medium, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, color: color.text, marginTop: space[2] },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  prices: { flexDirection: "row", gap: space[6], marginTop: space[3] },
  price: { fontFamily: font.medium, fontSize: 42, letterSpacing: -1.2, color: color.text, fontVariant: ["tabular-nums"] },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  chart: { marginTop: space[5], paddingHorizontal: space[4] },
  ranges: { flexDirection: "row", gap: space[1], paddingHorizontal: space[4], marginTop: space[3] },
  range: { height: 30, paddingHorizontal: 12, borderRadius: radius.pill, justifyContent: "center" },
  rangeOn: { backgroundColor: "#eceadf" },
  rangeText: { fontFamily: font.medium, fontSize: 12, color: color.neutral700 },
  rangeTextOn: { color: "#0b0d0c" },
  stats: {
    flexDirection: "row",
    marginHorizontal: space[4],
    marginTop: space[4],
    paddingTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  statValue: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  tabRow: { flexGrow: 0, marginTop: space[5], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  tabs: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[4] },
  tab: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  tabOn: { backgroundColor: "#eceadf" },
  tabText: { fontFamily: font.medium, fontSize: text.ui, color: color.neutral800 },
  tabTextOn: { color: "#0b0d0c" },
  position: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginTop: space[4],
    padding: space[4],
    borderRadius: radius.panel,
    backgroundColor: "#121714",
  },
  pressed: { opacity: 0.8 },
  positionText: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  section: { gap: space[3], paddingTop: space[5] },
  rules: { fontFamily: font.regular, fontSize: text.body, lineHeight: 21, color: color.neutral800 },
  link: { fontFamily: font.medium, fontSize: text.body, color: color.text, textDecorationLine: "underline" },
  talk: { gap: 6, paddingBottom: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  talkHead: { fontFamily: font.medium, fontSize: text.ui, color: color.text },
  talkText: { fontFamily: font.regular, fontSize: text.body, lineHeight: 20, color: color.neutral800 },
  bookRow: { flexDirection: "row", gap: space[4], paddingVertical: 5 },
  bookCell: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  bookPrice: { fontFamily: font.medium, fontSize: text.body, fontVariant: ["tabular-nums"] },
  bookSize: { fontFamily: font.regular, fontSize: text.body, color: color.neutral800, fontVariant: ["tabular-nums"] },
  tradeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  tradeSide: { width: 70, fontFamily: font.medium, fontSize: text.body },
  tradeText: { flex: 1, fontFamily: font.regular, fontSize: text.body, color: color.text, fontVariant: ["tabular-nums"] },
  buy: {
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
  buyButton: { flex: 1 },
});
