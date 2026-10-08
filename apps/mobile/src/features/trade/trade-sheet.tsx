/**
 * Buying a side, in three steps:
 *  1. the sheet: side, amount, the live quote and what each result means;
 *  2. review: the order spelled out (price × shares, every fee, the total,
 *     when it cancels), placed by press-and-hold;
 *  3. filled: what you own now, and a nudge to say why (or, when the venue
 *     hasn't filled it yet, that it's on its way).
 * Opened from a post (Back the author's side, or Fade it) or from a market;
 * one sheet for both, the post's call heading it when there is one.
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
import { ClockIcon } from "phosphor-react-native/src/icons/Clock";
import { FingerprintIcon } from "phosphor-react-native/src/icons/Fingerprint";
import { PencilSimpleLineIcon } from "phosphor-react-native/src/icons/PencilSimpleLine";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { MarketDTO, PostDTO, QuoteDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button, PRIMARY_INK } from "~/components/button";
import { HoldButton } from "~/components/hold-button";
import { VenueMark } from "~/components/venue-mark";
import { updateDraft } from "~/features/compose/draft";
import { useRecords } from "~/features/feed/use-records";
import { AddFundsSheet } from "~/features/wallet/add-funds-sheet";
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

type Stage = "edit" | "review" | "pending" | "done";
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
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
const shareCount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function TradeSheet({ post, market, outcome: initial, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const venues = useVenues();
  const records = useRecords();
  const presets = post ? [1000, 5000, 10000] : [2500, 10000, 25000];
  const [outcome, setOutcome] = useState<Outcome>(initial ?? post?.outcome ?? "Yes");
  const [amount, setAmount] = useState(post ? 5000 : 10000);
  const [stage, setStage] = useState<Stage>("edit");
  const [placing, setPlacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fill, setFill] = useState<Fill | null>(null);
  const [pending, setPending] = useState<{ shares: number; at: string } | null>(null);
  const [step, setStep] = useState<OrderStep | null>(null);
  const [funding, setFunding] = useState(false);
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
      setPending(null);
    }
  }

  const available = trading.availableCents ?? 0;
  // The most this wallet can spend, in whole dollars.
  const maxCents = Math.floor(available / 100) * 100;
  const tooSmall = amount < trading.minOrderCents;
  const venue = venues.get(market.venueId)?.name ?? market.venueId;
  const short = market.shortTitle || market.title;
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
    enabled: open && amount > 0 && (stage === "edit" || stage === "review"),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
  const q = quote.data && quote.data.outcome === outcome ? quote.data : undefined;
  // Unknown balance (the chain didn't answer) isn't zero: let the venue decide.
  const insufficient = trading.availableCents !== null && amount > trading.availableCents;
  const other = opposite(outcome);
  const sideLabel = (side: Outcome) =>
    post ? `${side === post.outcome ? "BACK" : "FADE"} ${first.toUpperCase()} · ${side.toUpperCase()}` : `BUY ${side.toUpperCase()}`;

  async function place() {
    if (!q) return;
    if (trading.live && trading.wallet.status !== "ready") {
      setProblem(trading.wallet.status === "loading" ? "Your wallet is still loading. Try again in a moment." : trading.wallet.reason);
      setStage("edit");
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
      if (order.status === "pending") {
        // Landed, not filled yet: it keeps going at the venue and shows in the portfolio when it does.
        setPending({ shares: q.shares, at: order.at });
        setStage("pending");
        queryClient.invalidateQueries({ queryKey: ["portfolio"] });
        if (trading.live) trading.refresh();
        return;
      }
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

  const toPortfolio = () => {
    onClose();
    router.navigate("/portfolio");
  };

  if (stage === "done" && fill)
    return (
      <Modal visible={open} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <Filled
          fill={fill}
          outcome={outcome}
          market={market}
          onPostCall={() => {
            onClose();
            updateDraft({ market, outcome });
            router.push("/compose");
          }}
          onPortfolio={toPortfolio}
          onClose={onClose}
        />
      </Modal>
    );

  const win = q ? q.payoutCents - q.totalCents : 0;
  const lose = q ? q.totalCents : 0;
  const problemText =
    problem ??
    (tooSmall
      ? `The minimum order is ${usd(trading.minOrderCents)}.`
      : insufficient
        ? trading.live
          ? `You have ${usd(available)} USDC.`
          : `That's more than your ${usd(available)} available.`
        : quote.error
          ? (quote.error as Error).message
          : null);
  const canUseMax = insufficient && !problem && maxCents >= trading.minOrderCents;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.anchor}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + space[2], 28) }]}>
          <View style={styles.grip} />

          {stage === "pending" && pending ? (
            <Pending
              shares={pending.shares}
              at={pending.at}
              outcome={outcome}
              short={short}
              venue={venue}
              onPortfolio={toPortfolio}
              onClose={onClose}
            />
          ) : stage === "review" && q ? (
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
                    <Avatar url={post.author.avatarUrl} size={24} />
                    <Text style={styles.headText} numberOfLines={1}>
                      <Text style={styles.headName}>{post.author.name}</Text>
                      {record ? ` · ${record}` : ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <VenueMark venueId={market.venueId} size={24} />
                    <Text style={styles.headText} numberOfLines={1}>
                      <Text style={styles.headName}>{short}</Text> · {venue}
                    </Text>
                  </>
                )}
                <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
                  <XIcon size={16} weight="bold" color={color.neutral700} />
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
                  <Text style={styles.meta} numberOfLines={1}>
                    {short} · {venue} · closes {shortDate(market.closesAt)}
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
                      accessibilityLabel={`${sideLabel(side).toLowerCase()}, ${price(bestAsk(market, side))}`}
                    >
                      <Text style={[styles.sideLabel, on && styles.sideOnText]}>{sideLabel(side)}</Text>
                      <Text style={[styles.sidePrice, on && styles.sideOnText]}>{price(bestAsk(market, side))}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>AMOUNT</Text>
              <View style={styles.amountRow}>
                <AmountInput cents={amount} onChange={setAmount} />
                <View style={styles.presets}>
                  {[...presets, -1].map((p) => {
                    const max = p === -1;
                    const value = max ? maxCents : p;
                    const disabled = max && maxCents < trading.minOrderCents;
                    const on = !disabled && value === amount;
                    const label = max ? "Max" : `$${p / 100}`;
                    return (
                      <Pressable
                        key={p}
                        onPress={() => setAmount(value)}
                        disabled={disabled}
                        style={[styles.preset, on && styles.presetOn, disabled && styles.presetOff]}
                        accessibilityRole="button"
                        accessibilityLabel={max ? `Max, ${usd(maxCents)}` : label}
                        accessibilityState={{ selected: on, disabled }}
                      >
                        <Text style={[styles.presetText, on && styles.presetTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.sub}>
                {q ? `${shareCount(q.shares)} shares at ${price(q.priceCents)} · ` : ""}
                {trading.live
                  ? trading.availableCents === null
                    ? "Wallet balance unavailable"
                    : `${usd(available)} USDC in your wallet`
                  : `${usd(available)} available`}
              </Text>

              <View style={styles.outcomes} accessibilityLabel={q ? `If ${outcome} wins, plus ${usd(win)}. If ${other} wins, minus ${usd(lose)}.` : undefined}>
                <View style={[styles.oc, styles.ocWin]}>
                  <Text style={styles.ocLabel}>If {outcome} wins</Text>
                  <Text style={[styles.ocValue, { color: color.gain }]}>{q ? `+${usd(win)}` : "—"}</Text>
                </View>
                <View style={[styles.oc, styles.ocLose]}>
                  <Text style={styles.ocLabel}>If {other} wins</Text>
                  <Text style={[styles.ocValue, { color: color.neutral800 }]}>{q ? `−${usd(lose)}` : "—"}</Text>
                </View>
              </View>

              {problemText ? (
                <View style={styles.problem} accessibilityLiveRegion="polite">
                  <View style={styles.problemRow}>
                    <WarningCircleIcon size={14} weight="fill" color={color.neg} />
                    <Text style={styles.problemText}>{problemText}</Text>
                  </View>
                  {insufficient && !problem ? (
                    <View style={styles.fixes}>
                      {canUseMax ? <Button size="xs" variant="quiet" label={`Use max ${usd(maxCents)}`} onPress={() => setAmount(maxCents)} /> : null}
                      {trading.live ? <Button size="xs" variant="quiet" label="Add funds" onPress={() => setFunding(true)} /> : null}
                    </View>
                  ) : null}
                </View>
              ) : q && !q.complete ? (
                <Text style={styles.note}>Only {shareCount(q.shares)} shares available at this price.</Text>
              ) : null}

              <View style={styles.foot}>
                <View style={{ gap: 2 }}>
                  <Text style={styles.total}>{q ? usd(q.totalCents) : "—"}</Text>
                  <Text style={styles.fees}>{q ? `incl. ${usd(q.feeCents)} fees` : "Getting a price…"}</Text>
                </View>
                <Button
                  size="lg"
                  label="Review order"
                  onPress={() => setStage("review")}
                  disabled={!q || insufficient || tooSmall || quote.isFetching}
                >
                  <ArrowRightIcon size={16} weight="bold" color={PRIMARY_INK} />
                </Button>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      <AddFundsSheet
        open={funding}
        onClose={() => {
          setFunding(false);
          if (trading.live) trading.refresh();
        }}
      />
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
        <Pressable
          onPress={onBack}
          disabled={placing}
          style={({ pressed }) => [styles.reviewBack, pressed && styles.circlePressed]}
          accessibilityRole="button"
          accessibilityLabel="Back to the order"
        >
          <CaretLeftIcon size={18} weight="bold" color={color.neutral700} />
        </Pressable>
        <Text style={styles.reviewHeadText}>Review order</Text>
      </View>
      <Text style={styles.small}>You’re buying</Text>
      <Text style={styles.buying}>
        {shareCount(q.shares)} {outcome} <Text style={styles.buyingAt}>at</Text> {price(q.priceCents)}
      </Text>
      <Text style={styles.marketLine}>
        {market.title} · {venue}
      </Text>

      <View style={[styles.cases, styles.reviewCases]}>
        <View style={[styles.case, styles.caseFirst]}>
          <Text style={styles.caseLabel}>If {outcome}, you get</Text>
          <Text style={[styles.caseValue, { color: color.gain }]}>{usd(q.payoutCents)}</Text>
          <Text style={[styles.caseNote, { color: color.gain }]}>+{usd(q.payoutCents - q.totalCents)} profit</Text>
        </View>
        <View style={styles.case}>
          <Text style={styles.caseLabel}>If {other}, you lose</Text>
          <Text style={[styles.caseValue, { color: color.neg }]}>{usd(q.totalCents)}</Text>
          <Text style={styles.caseNote}>your whole stake</Text>
        </View>
      </View>

      <Line label={`${shareCount(q.shares)} × ${price(q.priceCents)}`} value={usd(q.notionalCents)} />
      {q.fees.map((f) => (
        <Line key={f.label} label={f.source === "venue" ? `${venue} fee` : f.label} value={usd(f.cents)} />
      ))}
      <View style={styles.totalLine}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalLabel}>{usd(q.totalCents)}</Text>
      </View>
      <Text style={styles.fine}>
        {live
          ? `Paid in USDC from your wallet. ${venue} fills at the best price it can, within a few cents of ${price(q.priceCents)}; anything unfilled returns to your wallet. Needs a little SOL for the network fee.`
          : `Cancels if the price moves above ${price(q.priceCents + SLIPPAGE_CENTS)} before it fills. Simulated funds.`}
      </Text>
      <View style={styles.hold}>
        <HoldButton
          label="Hold to place order"
          icon={<FingerprintIcon size={18} weight="bold" color={PRIMARY_INK} />}
          onComplete={onPlace}
          loading={placing}
        />
      </View>
      {placing && step ? (
        <Text style={styles.step} accessibilityLiveRegion="polite">
          {STEP_LABEL[step]}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Sent and landed, but the venue hasn't filled it yet. */
function Pending({
  shares,
  at,
  outcome,
  short,
  venue,
  onPortfolio,
  onClose,
}: {
  shares: number;
  at: string;
  outcome: Outcome;
  short: string;
  venue: string;
  onPortfolio: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.pending} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <ClockIcon size={18} weight="fill" color={color.gold} />
        <Text style={styles.pendingTitle}>Order pending</Text>
        <View style={styles.pendingTag}>
          <Text style={styles.pendingTagText}>Pending</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <XIcon size={16} weight="bold" color={color.neutral700} />
        </Pressable>
      </View>
      <Text style={styles.pendingBody}>
        Buy {shareCount(shares)} {outcome} · {short}. Filling at {venue}; it shows in your portfolio when it fills.
      </Text>
      <Text style={styles.small}>
        0 / {shareCount(shares)} filled · {clock(at)}
      </Text>
      <Button variant="quiet" size="md" label="View portfolio" onPress={onPortfolio} style={{ marginTop: space[2] }}>
        <ArrowRightIcon size={15} weight="bold" color={color.text} />
      </Button>
    </View>
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
  onPostCall,
  onPortfolio,
  onClose,
}: {
  fill: Fill;
  outcome: Outcome;
  market: MarketDTO;
  onPostCall: () => void;
  onPortfolio: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const owned = fill.ownedShares ?? fill.shares;
  return (
    <View style={[styles.filled, { paddingTop: insets.top + 56, paddingBottom: Math.max(insets.bottom, 28) }]}>
      <Pressable onPress={onClose} style={[styles.filledClose, { top: insets.top + space[2] }]} accessibilityRole="button" accessibilityLabel="Close">
        <XIcon size={20} color={color.neutral700} />
      </Pressable>
      <View style={styles.check}>
        <CheckIcon size={24} weight="bold" color={PRIMARY_INK} />
      </View>
      <Text style={styles.small}>
        {fill.status === "filled" ? "Filled" : "Partly filled"} at {clock(fill.at)} · {shareCount(fill.shares)} / {shareCount(fill.requested)}
      </Text>
      <Text style={styles.own} accessibilityRole="header">
        You own{"\n"}
        {shareCount(owned)} {outcome}.
      </Text>
      <Text style={styles.ownBody}>
        Added {shareCount(fill.shares)} at {price(fill.priceCents)} to “{market.shortTitle || market.title}”.
        {fill.averageCents !== null && owned !== fill.shares ? ` Your average is now ${price(fill.averageCents)}.` : ""}
      </Text>
      <View style={[styles.cases, styles.filledCases]}>
        <View style={[styles.case, styles.caseFirst]}>
          <Text style={styles.caseLabel}>Paid incl. fees</Text>
          <Text style={[styles.caseValue, styles.filledValue]}>{usd(fill.totalCents)}</Text>
        </View>
        <View style={styles.case}>
          <Text style={styles.caseLabel}>Pays if {outcome}</Text>
          <Text style={[styles.caseValue, styles.filledValue, { color: color.gain }]}>{usd(owned * 100)}</Text>
        </View>
      </View>
      {fill.availableCents !== null ? <Text style={[styles.small, { marginTop: space[3] }]}>{usd(fill.availableCents)} left to trade</Text> : null}
      <View style={{ flex: 1 }} />
      <View style={styles.why}>
        <Text style={styles.whyTitle}>Tell people why.</Text>
        <Text style={styles.whyBody}>Say what you see that the price doesn’t. Your position shows on the post.</Text>
        <Button size="md" label="Post your call" onPress={onPostCall} icon={<PencilSimpleLineIcon size={17} weight="bold" color={PRIMARY_INK} />} />
      </View>
      <Pressable onPress={onPortfolio} style={({ pressed }) => [styles.view, pressed && styles.circlePressed]} accessibilityRole="button">
        <Text style={styles.viewText}>View portfolio</Text>
        <ArrowRightIcon size={15} weight="bold" color={color.text} />
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
        cursorColor={color.pos}
        selectionColor={color.pos}
        // Sized to its digits so the presets keep their place beside it.
        style={[styles.amountInput, { width: Math.max(1, shown.length) * 30 + 6 }]}
        accessibilityLabel="Amount in dollars"
        selectTextOnFocus
      />
    </View>
  );
}

const RULE = "rgba(255, 255, 255, 0.08)";

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  anchor: { flex: 1, justifyContent: "flex-end", pointerEvents: "box-none" },
  sheet: {
    maxHeight: "92%",
    paddingHorizontal: space[5],
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#0c100e",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 -20px 60px rgba(0, 0, 0, 0.6)",
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.14)", marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  headText: { flex: 1, fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  headName: { fontFamily: font.regular, color: color.text },
  // A 44pt target around a 16pt glyph, its edge on the sheet's padding.
  close: { width: 44, height: 44, marginVertical: -14, marginRight: -14, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  called: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    height: 24,
    marginTop: 18,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  calledText: { fontFamily: font.medium, fontSize: 11, color: color.neutral800 },
  title: { fontFamily: font.semibold, fontSize: 26, lineHeight: 30, letterSpacing: -0.8, color: color.text, marginTop: space[2] },
  meta: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[2] },
  sides: { flexDirection: "row", marginTop: 22, borderTopWidth: 1, borderBottomWidth: 1, borderColor: RULE },
  side: { flex: 1, paddingVertical: 14, paddingLeft: space[4], gap: 4, borderBottomWidth: 2, marginBottom: -1, borderBottomColor: "transparent" },
  sideFirst: { paddingLeft: 0, borderRightWidth: 1, borderRightColor: RULE },
  sideOn: { borderBottomColor: color.text },
  sideLabel: { fontFamily: font.medium, fontSize: 11, letterSpacing: 0.66, color: color.neutral700 },
  sidePrice: { fontFamily: font.medium, fontSize: 24, letterSpacing: -0.48, color: color.neutral700, fontVariant: ["tabular-nums"] },
  sideOnText: { color: color.text },
  label: { fontFamily: font.medium, fontSize: 11, letterSpacing: 0.66, color: color.neutral700, marginTop: 20 },
  amountRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 2 },
  amount: { flexDirection: "row", alignItems: "center" },
  amountDollar: { fontFamily: font.medium, fontSize: 52, lineHeight: 52, letterSpacing: -2, color: color.text },
  amountInput: { fontFamily: font.medium, fontSize: 52, lineHeight: 52, letterSpacing: -2, color: color.text, padding: 0, fontVariant: ["tabular-nums"] },
  presets: { flexDirection: "row", flexShrink: 1, gap: 4, paddingBottom: 4 },
  preset: { height: 34, paddingHorizontal: 11, borderRadius: radius.pill, justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  presetOn: { borderColor: "rgba(255, 255, 255, 0.22)" },
  presetOff: { opacity: 0.4 },
  presetText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  presetTextOn: { color: color.text },
  sub: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: 6, fontVariant: ["tabular-nums"] },
  outcomes: { flexDirection: "row", gap: space[2], marginTop: 22 },
  oc: { flex: 1, gap: 2, paddingVertical: space[3], paddingHorizontal: 14, borderRadius: radius.sheet },
  ocWin: { backgroundColor: "rgba(111, 211, 143, 0.08)" },
  ocLose: { backgroundColor: "rgba(255, 255, 255, 0.04)" },
  ocLabel: { fontFamily: font.regular, fontSize: 11, color: color.neutral700 },
  ocValue: { fontFamily: font.semibold, fontSize: 18, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  problem: { gap: space[2], marginTop: space[3] },
  problemRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  problemText: { flex: 1, fontFamily: font.regular, fontSize: 12, color: color.neg },
  fixes: { flexDirection: "row", gap: space[2] },
  note: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[3] },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], marginTop: space[5] },
  total: { fontFamily: font.medium, fontSize: 18, color: color.text, fontVariant: ["tabular-nums"] },
  fees: { fontFamily: font.regular, fontSize: 11, color: color.neutral700, fontVariant: ["tabular-nums"] },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space[2], marginBottom: 14 },
  reviewBack: { width: 36, height: 36, marginLeft: -8, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  circlePressed: { backgroundColor: color.neutral300 },
  reviewHeadText: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700 },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
  buying: { fontFamily: font.medium, fontSize: 38, lineHeight: 40, letterSpacing: -1.14, color: color.text, marginTop: 4, fontVariant: ["tabular-nums"] },
  buyingAt: { color: color.neutral600 },
  marketLine: { fontFamily: font.regular, fontSize: text.ui, lineHeight: 18, color: color.neutral700, marginTop: space[2] },
  cases: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: RULE },
  reviewCases: { marginTop: 22, marginBottom: space[3] },
  filledCases: { marginTop: 28 },
  case: { flex: 1, gap: 3, paddingVertical: 14, paddingLeft: space[4] },
  caseFirst: { paddingLeft: 0, borderRightWidth: 1, borderRightColor: RULE },
  caseLabel: { fontFamily: font.regular, fontSize: 11, lineHeight: 16, color: color.neutral700 },
  caseValue: { fontFamily: font.medium, fontSize: 22, color: color.text, fontVariant: ["tabular-nums"] },
  filledValue: { fontSize: 20 },
  caseNote: { fontFamily: font.regular, fontSize: 11, color: color.neutral700, fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9 },
  lineLabel: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral700, fontVariant: ["tabular-nums"] },
  lineValue: { fontFamily: font.regular, fontSize: text.ui, color: color.text, fontVariant: ["tabular-nums"] },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: space[3],
    marginTop: space[1],
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  totalLabel: { fontFamily: font.medium, fontSize: text.post, color: color.text, fontVariant: ["tabular-nums"] },
  fine: { fontFamily: font.regular, fontSize: 11, lineHeight: 16.5, color: color.neutral700, marginTop: 18 },
  hold: { marginTop: 14 },
  step: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, textAlign: "center", marginTop: space[3] },
  pending: { gap: space[2] },
  pendingTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  pendingTag: { height: 22, paddingHorizontal: 9, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.gold200 },
  pendingTagText: { fontFamily: font.medium, fontSize: 11, color: color.gold },
  pendingBody: { fontFamily: font.regular, fontSize: text.body, lineHeight: 21, color: color.neutral800, marginTop: space[2] },
  filled: {
    flex: 1,
    paddingHorizontal: space[5],
    backgroundColor: color.bg,
    experimental_backgroundImage: "radial-gradient(80% 40% at 50% 22%, rgba(111, 211, 143, 0.14) 0%, rgba(9, 13, 11, 0) 100%)",
  },
  filledClose: { position: "absolute", right: space[2], zIndex: 1, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  check: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b5e6a1",
    experimental_backgroundImage: "linear-gradient(180deg, #c3edb1, #a7dd92)",
    marginBottom: 28,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 24px -8px rgba(0,0,0,0.6)",
  },
  own: { fontFamily: font.medium, fontSize: 40, lineHeight: 42, letterSpacing: -1.2, color: color.text, marginTop: 6 },
  ownBody: { fontFamily: font.regular, fontSize: text.body, lineHeight: 21, color: color.neutral800, marginTop: 10 },
  why: { gap: space[3], padding: space[4], borderRadius: radius.drawer, backgroundColor: "#121714" },
  whyTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  whyBody: { fontFamily: font.regular, fontSize: 12, lineHeight: 18, color: color.neutral700 },
  view: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, marginTop: 10, borderRadius: radius.pill },
  viewText: { fontFamily: font.medium, fontSize: text.body, color: color.text },
});
