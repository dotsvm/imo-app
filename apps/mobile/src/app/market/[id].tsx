/**
 * One market: its question and prices, the Yes line over a range, the
 * numbers the venue reports, and four views — Overview (your position, the
 * top of the book, how it resolves, the best of the discussion), Book,
 * Trades, Discussion — with Buy Yes / Buy No at hand where it can be traded.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowClockwiseIcon } from "phosphor-react-native/src/icons/ArrowClockwise";
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { LockSimpleIcon } from "phosphor-react-native/src/icons/LockSimple";
import { WifiSlashIcon } from "phosphor-react-native/src/icons/WifiSlash";
import type { BookDTO, CandlesDTO, FeedPage, MarketDTO, PortfolioDTO, TradesDTO, WatchlistsDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { VenueBadge } from "~/components/venue-badge";
import { useConfig } from "~/features/auth/auth";
import { compactUsd, hasHistory } from "~/features/discover/market-row";
import { PostCard } from "~/features/feed/post-card";
import { Notice } from "~/features/home/notice";
import { PriceChart } from "~/features/market/price-chart";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { useTradable } from "~/features/trade/use-tradable";
import { api, API_URL } from "~/lib/api";
import { price, signedUsd, usd } from "~/lib/format";
import { bestAsk, complement, type Outcome } from "~/lib/market";
import { useVenues } from "~/lib/venues";
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
/** Rules longer than this fold behind "Full rules". */
const RULES_FOLD = 220;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function MarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const venues = useVenues();
  const tradable = useTradable();
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
  const claims = (portfolio.data?.claims ?? []).filter((c) => c.marketId === id);

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
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.headerIcon, pressed && styles.iconPressed]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <CaretLeftIcon size={20} weight="bold" color={color.text} />
      </Pressable>
      {m ? (
        <View style={styles.crumb}>
          <VenueBadge venueId={m.venueId} size={16} textStyle={styles.crumbText} />
          <Text style={styles.crumbText} numberOfLines={1}>
            · {m.category}
          </Text>
        </View>
      ) : market.isPending ? (
        <View style={styles.crumb}>
          <Skeleton width={80} height={14} />
          <Skeleton width={60} height={14} />
        </View>
      ) : (
        <View style={styles.crumb} />
      )}
      {m ? (
        <>
          <Pressable
            onPress={toggleSave}
            style={({ pressed }) => [styles.headerIcon, pressed && styles.iconPressed]}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? "Remove from saved" : "Save market"}
            accessibilityState={{ selected: isSaved }}
          >
            <BookmarkSimpleIcon size={18} weight="fill" color={isSaved ? color.pos : color.text} />
          </Pressable>
          <Pressable
            onPress={() => Share.share({ message: `${m.title} ${API_URL}/market/${encodeURIComponent(m.id)}` })}
            style={({ pressed }) => [styles.headerIcon, pressed && styles.iconPressed]}
            accessibilityRole="button"
            accessibilityLabel="Share"
          >
            <ExportIcon size={18} weight="bold" color={color.text} />
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
        <View style={styles.hero} accessibilityLabel="Loading the market" accessibilityRole="progressbar">
          <View style={{ gap: 8 }}>
            <Skeleton width="70%" height={30} />
            <Skeleton width="40%" height={30} />
          </View>
          <Skeleton width={180} height={12} />
          <View style={styles.prices}>
            <Skeleton width={100} height={48} />
            <Skeleton width={100} height={48} />
          </View>
          <Skeleton height={200} style={{ borderRadius: radius.card }} />
          <View style={styles.statsLoading}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={36} style={{ flex: 1 }} />
            ))}
          </View>
        </View>
      </View>
    );

  const venue = venues.get(m.venueId)?.name ?? m.venueId;
  const daysLeft = Math.max(0, Math.ceil((Date.parse(m.closesAt) - now) / 86_400_000));
  const closes = shortDate(m.closesAt);
  const open = m.status === "open";
  const canTrade = open && tradable(m.venueId);
  const priced = m.quoteUpdatedAt !== null;
  const points = (candles.data?.points ?? []).map((p) => p.yes);
  const items = posts.data?.items ?? [];
  const winner = m.resolution.void ? null : (m.resolution.outcome ?? null);

  // Only what the venue reports: zeros are missing data, not facts.
  const stats: { label: string; value: string }[] = [];
  if (m.volumeCents > 0) stats.push({ label: "Volume", value: compactUsd(m.volumeCents) });
  if (m.traders > 0) stats.push({ label: "Traders", value: m.traders.toLocaleString("en-US") });
  if (m.openInterestCents > 0) stats.push({ label: "Open int.", value: compactUsd(m.openInterestCents) });
  if (stats.length < 3 && open && m.yesAsk != null && m.yesBid != null)
    stats.push({ label: "Spread", value: price(Math.round((m.yesAsk - m.yesBid) * 10) / 10) });
  if (stats.length < 3) stats.push({ label: open ? "Closes" : "Closed", value: closes });

  const rules = `${m.resolution.rule}${m.resolution.source ? ` Source: ${m.resolution.source}.` : ""}`;
  const folds = rules.length > RULES_FOLD;
  const shownRules = folds && !rulesOpen ? `${rules.slice(0, rules.lastIndexOf(" ", RULES_FOLD))}…` : rules;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: canTrade ? 116 + insets.bottom : insets.bottom + space[5] }}>
        <View style={styles.hero}>
          <Text style={styles.title}>{m.title}</Text>
          <View style={{ gap: 8 }}>
            <Text style={styles.meta}>
              {STATUS[m.status] ?? m.status} ·{" "}
              {open ? `closes ${closes} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : `closed ${closes}`}
            </Text>
            {m.status === "closed" ? (
              <>
                <Tag label="Closed" />
                <Text style={styles.meta}>Trading halted. Last price {price(m.yesPrice)} is not a result.</Text>
              </>
            ) : m.status === "resolved" ? (
              <Tag label={m.resolution.void ? "Voided" : `Resolved · ${m.resolution.outcome ?? "—"}`} />
            ) : null}
          </View>
          <View style={styles.prices}>
            <PriceBlock label="Yes" cents={priced ? m.yesPrice : null} change={hasHistory(m) ? m.change : null} strong />
            <PriceBlock label="No" cents={priced ? complement(m.yesPrice) : null} change={hasHistory(m) ? -m.change : null} />
          </View>

          <View style={styles.chart}>
            {points.length > 1 ? (
              <PriceChart points={points} height={140} />
            ) : candles.isPending ? (
              <Skeleton height={140} style={{ borderRadius: radius.card }} />
            ) : (
              <View style={styles.noChart}>
                <Text style={styles.small}>No price history yet</Text>
              </View>
            )}
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
            {stats.slice(0, 3).map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} />
            ))}
          </View>
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
          <View style={styles.body}>
            {m.status === "resolved" && (claims.length || held.length) ? (
              claims.length ? (
                claims.map((c) => (
                  <View key={c.id} style={styles.claim}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.small}>
                        You hold {c.shares.toLocaleString("en-US", { maximumFractionDigits: 2 })} {c.outcome}
                      </Text>
                      <Text style={styles.positionText}>Payout {usd(c.payoutCents)}</Text>
                    </View>
                    <Button size="sm" label={`Claim ${usd(c.payoutCents)}`} onPress={() => router.push(`/position/${encodeURIComponent(c.positionId)}`)} />
                  </View>
                ))
              ) : held.every((p) => p.outcome !== winner) ? (
                <View style={styles.claim}>
                  <Text style={styles.small}>Nothing to claim.</Text>
                </View>
              ) : null
            ) : null}

            {held.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/position/${encodeURIComponent(p.id)}`)}
                style={({ pressed }) => [styles.position, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Your position: ${p.shares.toLocaleString("en-US")} ${p.outcome}, worth ${usd(p.valueCents)}`}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.small}>Your position</Text>
                  <Text style={styles.positionText}>
                    {p.shares.toLocaleString("en-US", { maximumFractionDigits: 2 })} {p.outcome} · avg{" "}
                    {price(Math.round((p.costCents / p.shares) * 10) / 10)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 3 }}>
                  <Text style={styles.positionText}>{usd(p.valueCents)}</Text>
                  <Text style={[styles.small, { color: p.unrealizedCents < 0 ? color.neg : p.unrealizedCents > 0 ? color.gain : color.neutral700 }]}>
                    {signedUsd(p.unrealizedCents)}
                  </Text>
                </View>
                <CaretRightIcon size={16} weight="bold" color={color.neutral700} />
              </Pressable>
            ))}

            <Section title="Order book · Yes" top={held.length || claims.length ? 24 : 0} gap={10}>
              <Book book={book.data} error={book.isError} venue={venue} onRetry={() => book.refetch()} rows={3} />
            </Section>

            <Section title="How it resolves" top={28} gap={8}>
              <Text style={styles.rules}>
                {shownRules}
                {folds ? (
                  <>
                    {" "}
                    <Text style={styles.link} onPress={() => setRulesOpen(!rulesOpen)} accessibilityRole="button">
                      {rulesOpen ? "Show less" : "Full rules"}
                    </Text>
                  </>
                ) : null}
              </Text>
            </Section>

            {items.length ? (
              <Section title="Top discussion" top={28} gap={0}>
                {items.slice(0, 3).map((p) => (
                  <Pressable key={p.id} onPress={() => router.push(`/post/${p.id}`)} style={styles.talk} accessibilityRole="link">
                    <View style={styles.talkHead}>
                      <Text style={styles.talkName}>{p.author.name}</Text>
                      <Text style={styles.small}>
                        {p.disclosePosition && p.evidenceShares > 0
                          ? `Holds ${p.evidenceShares.toLocaleString("en-US")} ${p.outcome}`
                          : `Called ${p.outcome}`}
                      </Text>
                    </View>
                    <Text style={styles.talkText} numberOfLines={3}>
                      {p.text}
                    </Text>
                  </Pressable>
                ))}
              </Section>
            ) : null}
          </View>
        ) : tab === "book" ? (
          <View style={styles.body}>
            <Book book={book.data} error={book.isError} venue={venue} onRetry={() => book.refetch()} rows={20} />
          </View>
        ) : tab === "trades" ? (
          <View style={styles.body}>
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
                  onTrade={(_e, o) => {
                    if (canTrade && !m.paused) setTrade(o);
                  }}
                />
              ))
            ) : (
              <Notice title="No takes on this market yet" body="Be the first to say what you think happens." />
            )}
          </View>
        )}
      </ScrollView>

      {canTrade ? (
        <View style={[styles.buy, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <View style={styles.fade} />
          {m.paused ? (
            <Text style={styles.paused}>Trading paused at {venue}.</Text>
          ) : (
            <>
              <Button size="lg" onPress={() => setTrade("Yes")} style={styles.buyButton} accessibilityLabel={`Buy Yes at ${price(bestAsk(m, "Yes"))}`}>
                <Text style={[styles.buyText, { color: PRIMARY_INK }]}>
                  Buy Yes <Text style={{ opacity: 0.55 }}>·</Text> {price(bestAsk(m, "Yes"))}
                </Text>
              </Button>
              <Button
                size="lg"
                variant="surface"
                onPress={() => setTrade("No")}
                style={[styles.buyButton, styles.buyNo]}
                accessibilityLabel={`Buy No at ${price(bestAsk(m, "No"))}`}
              >
                <Text style={[styles.buyText, styles.buyNoText]}>
                  Buy No <Text style={{ opacity: 0.45 }}>·</Text> {price(bestAsk(m, "No"))}
                </Text>
              </Button>
            </>
          )}
        </View>
      ) : null}

      <TradeSheet post={null} market={m} outcome={trade} onClose={() => setTrade(null)} />
    </View>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <LockSimpleIcon size={12} weight="fill" color={color.neutral800} />
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function PriceBlock({ label, cents, change, strong }: { label: string; cents: number | null; change: number | null; strong?: boolean }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.price, !strong && { color: color.neutral600 }]}>{cents === null ? "—" : price(cents)}</Text>
      {change !== null ? (
        <Text style={[styles.small, { color: change > 0 ? color.pos : change < 0 ? color.neg : color.neutral700 }]}>
          {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
          {Math.abs(change).toFixed(1).replace(/\.0$/, "")}¢ today
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ title, top, gap, children }: { title: string; top: number; gap: number; children: ReactNode }) {
  return (
    <View style={{ paddingTop: top, gap }}>
      <Text style={styles.small}>{title}</Text>
      {children}
    </View>
  );
}

function Book({
  book,
  error,
  venue,
  onRetry,
  rows,
}: {
  book: BookDTO | undefined;
  error: boolean;
  venue: string;
  onRetry: () => void;
  rows: number;
}) {
  if (!book && error)
    return (
      <View style={styles.bookError}>
        <WifiSlashIcon size={20} weight="fill" color={color.neutral700} />
        <Text style={styles.bookErrorTitle}>Couldn’t load the order book</Text>
        <Text style={styles.bookErrorBody}>{venue} didn’t respond. Prices may be stale.</Text>
        <Button size="sm" label="Retry" icon={<ArrowClockwiseIcon size={14} weight="bold" color={PRIMARY_INK} />} onPress={onRetry} />
      </View>
    );
  if (!book) return <Skeleton height={80} style={{ borderRadius: radius.card }} />;
  const n = Math.min(rows, Math.max(book.bids.length, book.asks.length));
  if (!n) return <Text style={styles.small}>No resting orders right now.</Text>;
  return (
    <View style={{ gap: 7 }}>
      <View style={styles.bookRow}>
        <Text style={[styles.bookHead, styles.bookCell]}>Bids</Text>
        <Text style={[styles.bookHead, styles.bookCell]}>Asks</Text>
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
  header: { flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], minHeight: 48 },
  headerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  iconPressed: { backgroundColor: color.neutral300 },
  crumb: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  crumbText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  hero: { paddingHorizontal: 20, paddingTop: space[2], paddingBottom: 20, gap: 14 },
  title: { fontFamily: font.medium, fontSize: 26, lineHeight: 30, letterSpacing: -0.52, color: color.text },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  tagText: { fontFamily: font.medium, fontSize: 11, color: color.neutral800 },
  prices: { flexDirection: "row", alignItems: "flex-end", gap: 28, marginTop: space[1] },
  price: { fontFamily: font.medium, fontSize: 44, lineHeight: 44, letterSpacing: -1.32, color: color.text, fontVariant: ["tabular-nums"] },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  chart: { marginTop: space[1] },
  noChart: { height: 140, alignItems: "center", justifyContent: "center", borderRadius: radius.card, backgroundColor: color.neutral100 },
  ranges: { flexDirection: "row", gap: 2 },
  range: { height: 30, paddingHorizontal: 13, borderRadius: radius.pill, justifyContent: "center" },
  rangeOn: { backgroundColor: "#eceadf" },
  rangeText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  rangeTextOn: { fontFamily: font.medium, color: "#0b0d0c" },
  stats: {
    flexDirection: "row",
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  statsLoading: { flexDirection: "row", gap: space[4] },
  statValue: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  tabRow: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  tabs: { gap: 6, paddingHorizontal: 20, paddingBottom: space[4] },
  tab: { height: 32, paddingHorizontal: 13, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  tabOn: { backgroundColor: "#eceadf" },
  tabText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  tabTextOn: { fontFamily: font.medium, color: "#0b0d0c" },
  body: { paddingHorizontal: 20, paddingTop: space[4] },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: 14,
    paddingHorizontal: space[4],
    marginBottom: space[2],
    borderRadius: 18,
    backgroundColor: "#121714",
  },
  position: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: 14,
    paddingHorizontal: space[4],
    borderRadius: 18,
    backgroundColor: "#121714",
  },
  pressed: { opacity: 0.8 },
  positionText: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  rules: { fontFamily: font.regular, fontSize: text.body, lineHeight: 21.7, color: color.neutral800 },
  link: { color: color.text, textDecorationLine: "underline" },
  talk: { gap: 5, paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.divider },
  talkHead: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  talkName: { fontFamily: font.medium, fontSize: 12, color: color.text },
  talkText: { fontFamily: font.regular, fontSize: text.body, lineHeight: 20, color: color.text },
  bookRow: { flexDirection: "row", gap: space[4] },
  bookCell: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  bookHead: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  bookPrice: { fontFamily: font.regular, fontSize: text.ui, fontVariant: ["tabular-nums"] },
  bookSize: { fontFamily: font.regular, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  bookError: { alignItems: "flex-start", gap: space[2], paddingVertical: space[2] },
  bookErrorTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  bookErrorBody: { fontFamily: font.regular, fontSize: text.ui, lineHeight: 19, color: color.neutral700, marginBottom: space[1] },
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
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    backgroundColor: color.bg,
  },
  // Content fades out above the bar instead of meeting a hard edge.
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -32,
    height: 32,
    pointerEvents: "none",
    experimental_backgroundImage: "linear-gradient(180deg, rgba(9, 13, 11, 0), #090d0b)",
  },
  buyButton: { flex: 1 },
  buyNo: { borderColor: "rgba(255, 255, 255, 0.12)" },
  buyText: { fontFamily: font.semibold, fontSize: text.post, fontVariant: ["tabular-nums"] },
  buyNoText: { fontFamily: font.medium, color: color.text },
  paused: { flex: 1, lineHeight: 52, textAlign: "center", fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
});
