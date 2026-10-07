/**
 * Buying a side, in three steps:
 *  1. the sheet: side, amount, the live quote and what each result means;
 *  2. review: the order spelled out (price × shares, every fee, the total,
 *     when it cancels), placed by press-and-hold;
 *  3. filled: what you own now, and a nudge to say why.
 * Opened from a post (Back the author's side, or Fade it) or from a market.
 * With real money the order is the venue's own transaction, signed by the
 * trader's wallet on this device; on a paper server it fills against the
 * venue's real book with demo cash.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { FingerprintIcon } from "phosphor-react-native/src/icons/Fingerprint";
import { PencilSimpleIcon } from "phosphor-react-native/src/icons/PencilSimple";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { MarketDTO, PostDTO, QuoteDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button, PRIMARY_INK } from "~/components/button";
import { HoldButton } from "~/components/hold-button";
import { VenueMark } from "~/components/venue-mark";
import { useMe } from "~/features/auth/use-account";
import { updateDraft } from "~/features/compose/draft";
import { useRecords } from "~/features/feed/use-records";
import { placeWalletOrder, STEP_LABEL, type OrderStep } from "~/features/wallet/orders";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { price, usd } from "~/lib/format";
import { bestAsk, opposite, type Outcome } from "~/lib/market";
import { useVenues } from "~/lib/venues";
import { color, font, radius, space, text } from "~/theme/tokens";

interface Props {
  /** The take being backed or faded; null to trade the market on its own. */
  post: PostDTO | null;
  market: MarketDTO;
  /** The side to open on; null keeps the sheet closed. */
  outcome: Outcome | null;
  onClose: () => void;
}

type Stage = "edit" | "review" | "done";
interface Fill {
  shares: number;
  /** What was asked for, and the quoted price per share. */
  requested: number;
  priceCents: number;
  totalCents: number;
  status: string;
  at: string;
  ownedShares: number | null;
  averageCents: number | null;
  availableCents: number | null;
}
interface PositionDTO {
  position: { shares: number; costCents: number } | null;
}

/** The server cancels a fill that would cost more than this past the quoted price. */
const SLIPPAGE_CENTS = 2;
const clientId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function TradeSheet({ post, market, outcome: initial, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const venues = useVenues();
  const records = useRecords();
  const me = useMe().data;
  const presets = post ? [1000, 5000, 10000] : [2500, 10000, 25000];
  const [outcome, setOutcome] = useState<Outcome>(initial ?? post?.outcome ?? "Yes");
  const [amount, setAmount] = useState(post ? 5000 : 10000);
  const [stage, setStage] = useState<Stage>("edit");
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [step, setStep] = useState<OrderStep | null>(null);
  const trading = useTrading();

  // A fresh sheet each time it opens.
  const open = initial !== null;
  const key = open ? `${post?.id ?? market.id}:${initial}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setOutcome(initial!);
      setAmount(post ? 5000 : 10000);
      setStage("edit");
      setProblem(null);
      setFill(null);
    }
  }

  const available = trading.availableCents ?? 0;
  const tooSmall = amount < trading.minOrderCents;
  const venue = venues.get(market.venueId)?.name ?? market.venueId;
  const first = post?.author.name.split(" ")[0] ?? "";
  const stats = post ? records.byId.get(post.authorId) : undefined;
  const record =
    stats && stats.resolved >= records.minSample
      ? `${Math.round((stats.correct / stats.resolved) * 100)}% right on ${stats.resolved.toLocaleString("en-US")}`
      : null;

  const quote = useQuery({
    queryKey: ["quote", market.id, outcome, amount],
    queryFn: ({ signal }) =>
      api<QuoteDTO>("/quotes", { body: { market: market.id, side: "Buy", outcome, amountCents: amount }, signal }),
    enabled: open && amount > 0 && stage !== "done",
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
  const q = quote.data && quote.data.outcome === outcome ? quote.data : undefined;
  // Unknown balance (the chain didn't answer) isn't zero: let the venue decide.
  const insufficient = trading.availableCents !== null && amount > trading.availableCents;
  void me;
  const other = opposite(outcome);
  const sideLabel = (side: Outcome) =>
    post ? `${side === post.outcome ? "BACK" : "FADE"} ${first.toUpperCase()} · ${side.toUpperCase()}` : `BUY ${side.toUpperCase()}`;

  async function place() {
    if (!q) return;
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still connecting. Try again in a moment." : trading.wallet.reason);
      return;
    }
    setPlacing(true);
    setProblem(null);
    try {
      const body = { market: market.id, side: "Buy" as const, outcome, amountCents: amount, postId: post?.id, clientOrderId: clientId("m") };
      const order =
        trading.live && trading.wallet.status === "ready"
          ? await placeWalletOrder(body, trading.wallet.sign, setStep)
          : await api<{ status: string; filledShares: number; filledTotalCents: number; reason: string | null; at: string }>("/orders", {
              body: { ...body, expectedPriceCents: q.priceCents },
            });
      if (order.status === "pending")
        throw new Error("Your order is on its way at Jupiter. It'll show in your portfolio when it fills.");
      if (order.status === "rejected" || order.status === "failed" || order.filledShares === 0)
        throw new Error(order.reason ?? "The order didn't fill. Nothing was charged.");
      // What they hold now, and what's left to trade.
      const [held, left] = await Promise.all([
        api<PositionDTO>(`/positions/${market.id}:${outcome.toLowerCase()}`).catch(() => null),
        trading.live
          ? trading.refresh().then((r) => r.data?.balance?.usdcCents ?? null).catch(() => null)
          : queryClient
              .fetchQuery({ queryKey: ["me"], queryFn: () => api<{ account: { availableCents: number } }>("/me"), staleTime: 0 })
              .then((r) => r.account.availableCents)
              .catch(() => null),
      ]);
      const pos = held?.position ?? null;
      setFill({
        shares: order.filledShares,
        requested: q.shares,
        priceCents: q.priceCents,
        totalCents: order.filledTotalCents,
        status: order.status,
        at: order.at,
        ownedShares: pos?.shares ?? null,
        averageCents: pos && pos.shares ? Math.round((pos.costCents / pos.shares) * 10) / 10 : null,
        availableCents: left,
      });
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["position"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The order didn't go through. Try again.");
      setStage("edit");
    } finally {
      setPlacing(false);
      setStep(null);
    }
  }

  if (stage === "done" && fill)
    return (
      <Modal visible={open} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <Filled
          fill={fill}
          outcome={outcome}
          market={market}
          venue={venue}
          onPostCall={() => {
            onClose();
            updateDraft({ market, outcome });
            router.push("/compose");
          }}
          onPortfolio={() => {
            onClose();
            router.navigate("/portfolio");
          }}
          onClose={onClose}
        />
      </Modal>
    );

  const win = q ? q.payoutCents - q.totalCents : 0;
  const lose = q ? q.totalCents : 0;
  const winShare = q ? Math.max(0.12, Math.min(0.88, win / (win + lose || 1))) : 0.5;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.anchor}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
          <View style={styles.grip} />

          {stage === "review" && q ? (
            <Review
              q={q}
              market={market}
              venue={venue}
              outcome={outcome}
              placing={placing}
              step={step}
              live={trading.live}
              onBack={() => setStage("edit")}
              onPlace={place}
            />
          ) : (
            <>
              <View style={styles.head}>
                {post ? (
                  <>
                    <Avatar url={post.author.avatarUrl} size={26} />
                    <Text style={styles.headText} numberOfLines={1}>
                      <Text style={styles.headName}>{post.author.name}</Text>
                      {record ? ` · ${record}` : ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <VenueMark venueId={market.venueId} size={22} />
                    <Text style={styles.headText} numberOfLines={1}>
                      <Text style={styles.headName}>{market.shortTitle || market.title}</Text> · {venue}
                    </Text>
                  </>
                )}
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <XIcon size={20} color={color.neutral700} />
                </Pressable>
              </View>

              {post ? (
                <>
                  <View style={styles.called}>
                    <View style={[styles.dot, { backgroundColor: post.outcome === "Yes" ? color.pos : color.neg }]} />
                    <Text style={styles.calledText}>
                      Called {post.outcome} · {price(post.entryPrice)}
                    </Text>
                  </View>
                  <Text style={styles.title} numberOfLines={2}>
                    {post.text.split(/(?<=[.!?])\s/)[0] ?? post.text}
                  </Text>
                </>
              ) : null}

              <View style={styles.sides}>
                {(post ? ([post.outcome, opposite(post.outcome)] as const) : (["Yes", "No"] as const)).map((side, i) => {
                  const on = side === outcome;
                  return (
                    <Pressable
                      key={side}
                      onPress={() => setOutcome(side)}
                      style={[styles.side, i === 0 && styles.sideFirst, on && styles.sideOn]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={sideLabel(side).toLowerCase()}
                    >
                      <Text style={[styles.sideLabel, on && styles.sideLabelOn]}>{sideLabel(side)}</Text>
                      <Text style={[styles.sidePrice, on && styles.sidePriceOn]}>{price(bestAsk(market, side))}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>AMOUNT</Text>
              <View style={styles.amountRow}>
                <AmountInput cents={amount} onChange={setAmount} />
                <View style={styles.presets}>
                  {[...presets, -1].map((p) => {
                    const value = p === -1 ? Math.floor(available / 100) * 100 : p;
                    const on = value === amount;
                    return (
                      <Pressable
                        key={p}
                        onPress={() => value > 0 && setAmount(value)}
                        style={[styles.preset, on && styles.presetOn]}
                        accessibilityRole="button"
                        accessibilityLabel={p === -1 ? "Max" : `$${p / 100}`}
                      >
                        <Text style={[styles.presetText, on && styles.presetTextOn]}>{p === -1 ? "Max" : `$${p / 100}`}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.sub}>
                {q ? `${q.shares.toLocaleString("en-US")} shares at ${price(q.priceCents)} · ` : ""}
                {trading.live
                  ? trading.availableCents === null
                    ? "Wallet balance unavailable"
                    : `${usd(available)} USDC in your wallet`
                  : `${usd(available)} available`}
              </Text>

              <View style={styles.bar} accessibilityElementsHidden>
                <View style={[styles.barLose, { flex: 1 - winShare }]} />
                <View style={[styles.barWin, { flex: winShare }]} />
              </View>
              <View style={styles.barLabels}>
                <Text style={styles.barText}>
                  Lose if {other} <Text style={{ color: color.neg }}>{q ? `−${usd(lose)}` : "—"}</Text>
                </Text>
                <Text style={styles.barText}>
                  Win if {outcome} <Text style={{ color: color.pos }}>{q ? `+${usd(win)}` : "—"}</Text>
                </Text>
              </View>

              {problem || quote.error || insufficient || tooSmall ? (
                <Text style={styles.problem}>
                  {problem ??
                    (tooSmall
                      ? `The minimum order is ${usd(trading.minOrderCents)}.`
                      : insufficient
                        ? trading.live
                          ? `You have ${usd(available)} USDC. Add funds from your wallet in Me → Wallet.`
                          : `That's more than your ${usd(available)} available.`
                        : (quote.error as Error).message)}
                </Text>
              ) : null}

              <View style={styles.foot}>
                <View>
                  <Text style={styles.total}>{q ? usd(q.totalCents) : "—"}</Text>
                  <Text style={styles.fees}>{q ? `incl. ${usd(q.feeCents)} fees` : "Getting a price…"}</Text>
                </View>
                <Button label="Review order" onPress={() => setStage("review")} disabled={!q || insufficient || tooSmall || quote.isFetching}>
                  <ArrowRightIcon size={16} weight="bold" color={PRIMARY_INK} />
                </Button>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Review({
  q,
  market,
  venue,
  outcome,
  placing,
  step,
  live,
  onBack,
  onPlace,
}: {
  q: QuoteDTO;
  market: MarketDTO;
  venue: string;
  outcome: Outcome;
  placing: boolean;
  step: OrderStep | null;
  live: boolean;
  onBack: () => void;
  onPlace: () => void;
}) {
  const other = opposite(outcome);
  return (
    <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
      <View style={styles.reviewHead}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to the order">
          <CaretLeftIcon size={18} weight="bold" color={color.neutral700} />
        </Pressable>
        <Text style={styles.reviewHeadText}>Review order</Text>
      </View>
      <Text style={styles.small}>You’re buying</Text>
      <Text style={styles.buying}>
        {q.shares.toLocaleString("en-US")} {outcome} <Text style={styles.buyingAt}>at</Text> {price(q.priceCents)}
      </Text>
      <Text style={styles.small}>
        {market.title} · {venue}
      </Text>

      <View style={styles.cases}>
        <View style={[styles.case, styles.caseFirst]}>
          <Text style={styles.small}>If {outcome}, you get</Text>
          <Text style={[styles.caseValue, { color: color.pos }]}>{usd(q.payoutCents)}</Text>
          <Text style={[styles.caseNote, { color: color.pos }]}>+{usd(q.payoutCents - q.totalCents)} profit</Text>
        </View>
        <View style={styles.case}>
          <Text style={styles.small}>If {other}, you lose</Text>
          <Text style={[styles.caseValue, { color: color.neg }]}>{usd(q.totalCents)}</Text>
          <Text style={styles.caseNote}>your whole stake</Text>
        </View>
      </View>

      <Line label={`${q.shares.toLocaleString("en-US")} × ${price(q.priceCents)}`} value={usd(q.notionalCents)} />
      {q.fees.map((f) => (
        <Line key={f.label} label={f.source === "venue" ? `${venue} fee` : f.label} value={usd(f.cents)} />
      ))}
      <View style={styles.totalLine}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalLabel}>{usd(q.totalCents)}</Text>
      </View>
      <Text style={styles.fine}>
        {live
          ? `Real money: paid in USDC from your wallet. ${venue} fills at the best price it can, within a few cents of ${price(q.priceCents)}; anything unfilled returns to your wallet. You'll need a little SOL for the network fee.`
          : `Cancels if the price moves above ${price(q.priceCents + SLIPPAGE_CENTS)} before it fills. Simulated funds.`}
      </Text>
      <HoldButton
        label={live ? "Hold to sign and place" : "Hold to place order"}
        icon={<FingerprintIcon size={20} weight="bold" color={PRIMARY_INK} />}
        onComplete={onPlace}
        loading={placing}
      />
      {placing && step ? (
        <Text style={styles.step} accessibilityLiveRegion="polite">
          {STEP_LABEL[step]}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

function Filled({
  fill,
  outcome,
  market,
  venue,
  onPostCall,
  onPortfolio,
  onClose,
}: {
  fill: Fill;
  outcome: Outcome;
  market: MarketDTO;
  venue: string;
  onPostCall: () => void;
  onPortfolio: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const at = new Date(fill.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const owned = fill.ownedShares ?? fill.shares;
  return (
    <View style={[styles.filled, { paddingTop: insets.top + space[6], paddingBottom: Math.max(insets.bottom, space[4]) }]}>
      <Pressable onPress={onClose} hitSlop={10} style={[styles.filledClose, { top: insets.top + space[3] }]} accessibilityRole="button" accessibilityLabel="Close">
        <XIcon size={22} color={color.neutral700} />
      </Pressable>
      <View style={styles.check}>
        <CheckIcon size={28} weight="bold" color={PRIMARY_INK} />
      </View>
      <Text style={styles.small}>
        {fill.status === "filled" ? "Filled" : "Partly filled"} at {at} · {fill.shares.toLocaleString("en-US")} /{" "}
        {fill.requested.toLocaleString("en-US")}
      </Text>
      <Text style={styles.own}>
        You own{"\n"}
        {owned.toLocaleString("en-US")} {outcome}.
      </Text>
      <Text style={styles.ownBody}>
        Added {fill.shares.toLocaleString("en-US")} at {price(fill.priceCents)} to “{market.shortTitle || market.title}”.
        {fill.averageCents !== null && owned !== fill.shares ? ` Your average is now ${price(fill.averageCents)}.` : ""}
      </Text>
      <View style={styles.cases}>
        <View style={[styles.case, styles.caseFirst]}>
          <Text style={styles.small}>Paid incl. fees</Text>
          <Text style={styles.caseValue}>{usd(fill.totalCents)}</Text>
        </View>
        <View style={styles.case}>
          <Text style={styles.small}>Pays if {outcome}</Text>
          <Text style={[styles.caseValue, { color: color.pos }]}>{usd(owned * 100)}</Text>
        </View>
      </View>
      {fill.availableCents !== null ? <Text style={styles.small}>{usd(fill.availableCents)} left to trade · {venue}</Text> : null}
      <View style={{ flex: 1 }} />
      <View style={styles.why}>
        <Text style={styles.whyTitle}>Tell people why.</Text>
        <Text style={styles.whyBody}>Say what you see that the price doesn’t. Your position shows on the post.</Text>
        <Button size="lg" label="Post your call" onPress={onPostCall} icon={<PencilSimpleIcon size={17} weight="bold" color={PRIMARY_INK} />} />
      </View>
      <Pressable onPress={onPortfolio} style={styles.view} accessibilityRole="button">
        <Text style={styles.viewText}>View portfolio</Text>
        <ArrowRightIcon size={15} color={color.text} />
      </Pressable>
    </View>
  );
}

/** The big dollar figure, typed in directly; whole dollars. */
function AmountInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [draft, setDraft] = useState(String(cents / 100));
  // A preset chosen elsewhere replaces what was typed; an empty field while typing stays empty.
  const shown = draft === "" || Number(draft) * 100 === cents ? draft : String(cents / 100);
  return (
    <View style={styles.amount}>
      <Text style={styles.amountDollar}>$</Text>
      <TextInput
        value={shown}
        onChangeText={(t) => {
          const clean = t.replace(/[^\d]/g, "").slice(0, 6);
          setDraft(clean);
          const n = Number(clean);
          if (n > 0) onChange(n * 100);
        }}
        keyboardType="number-pad"
        // Sized to its digits so the presets keep their place beside it.
        style={[styles.amountInput, { width: Math.max(1, shown.length) * 28 + 6 }]}
        accessibilityLabel="Amount in dollars"
        selectTextOnFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  anchor: { flex: 1, justifyContent: "flex-end", pointerEvents: "box-none" },
  sheet: {
    maxHeight: "92%",
    paddingHorizontal: space[5],
    paddingTop: space[2],
    borderTopLeftRadius: radius.drawer + 4,
    borderTopRightRadius: radius.drawer + 4,
    backgroundColor: "#0d1210",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.neutral500, marginBottom: space[4] },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  headText: { flex: 1, fontFamily: font.regular, fontSize: text.body, color: color.neutral700 },
  headName: { fontFamily: font.medium, color: color.neutral800 },
  called: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: space[4],
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: color.neutral200,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  calledText: { fontFamily: font.medium, fontSize: 12, color: color.neutral800 },
  title: { fontFamily: font.semibold, fontSize: 24, lineHeight: 29, letterSpacing: -0.6, color: color.text, marginTop: space[3] },
  sides: {
    flexDirection: "row",
    marginTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  side: { flex: 1, paddingVertical: space[4], paddingLeft: space[4], gap: 8, borderBottomWidth: 2, borderBottomColor: "transparent" },
  sideFirst: { paddingLeft: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.neutral400 },
  sideOn: { borderBottomColor: color.text },
  sideLabel: { fontFamily: font.medium, fontSize: 11, letterSpacing: 0.8, color: color.neutral600 },
  sideLabelOn: { color: color.neutral800 },
  sidePrice: { fontFamily: font.medium, fontSize: 22, color: color.neutral600, fontVariant: ["tabular-nums"] },
  sidePriceOn: { color: color.text },
  label: { fontFamily: font.medium, fontSize: 11, letterSpacing: 0.8, color: color.neutral700, marginTop: space[5] },
  amountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[1] },
  amount: { flexDirection: "row", alignItems: "center" },
  amountDollar: { fontFamily: font.medium, fontSize: 48, color: color.text },
  amountInput: { fontFamily: font.medium, fontSize: 48, color: color.text, padding: 0, fontVariant: ["tabular-nums"] },
  presets: { flexDirection: "row", gap: 2 },
  preset: { height: 34, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: "center" },
  presetOn: { borderWidth: 1, borderColor: color.neutral500, backgroundColor: color.neutral200 },
  presetText: { fontFamily: font.medium, fontSize: text.ui, color: color.neutral700 },
  presetTextOn: { color: color.text },
  sub: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700, marginTop: space[1], fontVariant: ["tabular-nums"] },
  bar: { flexDirection: "row", gap: 4, height: 5, marginTop: space[5] },
  barLose: { borderRadius: 3, backgroundColor: color.neg },
  barWin: { borderRadius: 3, backgroundColor: "#7fd47a" },
  barLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: space[2] },
  barText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700, fontVariant: ["tabular-nums"] },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg, marginTop: space[3] },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[5] },
  total: { fontFamily: font.medium, fontSize: 20, color: color.text, fontVariant: ["tabular-nums"] },
  fees: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: 2 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space[3], marginBottom: space[4] },
  reviewHeadText: { fontFamily: font.regular, fontSize: text.body, color: color.neutral800 },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  buying: { fontFamily: font.medium, fontSize: 34, letterSpacing: -1, color: color.text, marginVertical: 4, fontVariant: ["tabular-nums"] },
  buyingAt: { color: color.neutral600 },
  cases: {
    flexDirection: "row",
    marginVertical: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  case: { flex: 1, gap: 5, paddingVertical: space[4], paddingLeft: space[4] },
  caseFirst: { paddingLeft: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.neutral400 },
  caseValue: { fontFamily: font.medium, fontSize: 22, color: color.text, fontVariant: ["tabular-nums"] },
  caseNote: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  lineLabel: { fontFamily: font.regular, fontSize: text.body, color: color.neutral800 },
  lineValue: { fontFamily: font.regular, fontSize: text.body, color: color.text, fontVariant: ["tabular-nums"] },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: space[3],
    marginTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.neutral400,
  },
  totalLabel: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  fine: { fontFamily: font.regular, fontSize: 11, lineHeight: 16, color: color.neutral700, marginTop: space[4], marginBottom: space[3] },
  step: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, textAlign: "center", marginTop: space[3] },
  filled: {
    flex: 1,
    paddingHorizontal: space[5],
    backgroundColor: color.bg,
    experimental_backgroundImage: "radial-gradient(120% 55% at 30% 0%, rgba(181, 230, 161, 0.12) 0%, rgba(9, 13, 11, 0) 70%)",
  },
  filledClose: { position: "absolute", right: space[4], zIndex: 1 },
  check: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    marginBottom: space[5],
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 24px -8px rgba(0,0,0,0.6)",
  },
  own: { fontFamily: font.medium, fontSize: 38, lineHeight: 42, letterSpacing: -1.2, color: color.text, marginTop: space[2] },
  ownBody: { fontFamily: font.regular, fontSize: text.body, lineHeight: 21, color: color.neutral800, marginTop: space[3] },
  why: { gap: space[3], padding: space[4], borderRadius: radius.drawer, backgroundColor: "#121714" },
  whyTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  whyBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.neutral700 },
  view: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space[4] },
  viewText: { fontFamily: font.medium, fontSize: text.post, color: color.text },
});
