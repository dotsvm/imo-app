"use client";
import Link from "next/link";
import { complement } from "@imo/core/market";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  Market,
  Order,
  Outcome,
  Position,
  Quote,
  Side,
} from "@imo/domain/types";
import { ApiRequestError } from "@/client/http";
import type { TicketRequest } from "@imo/domain/demo/contracts";
import { venueFeeNote, venueName } from "@/data/venues";
import { useDemo } from "@/services/provider";
import {
  availableCash,
  availableShares,
  bestAsk,
  bestBid,
  validateQuote,
} from "@imo/domain/engine";
import {
  appFeeFor,
  arrowUsd,
  centsText,
  parseDollars,
  priceFor,
  signedUsd,
  usd,
  venueFeeFor,
} from "@imo/domain/money";
import {
  ArrowRight,
  CaretLeft,
  Check,
  CheckCircle,
  CircleDashed,
  CircleX,
  Clock,
  Flag,
  Lock,
  PencilSimpleLine,
  Spinner,
  WarningCircle,
  X,
} from "@/components/icons";
import { SwipeToReview } from "@/components/swipe-to-review";
import { Button } from "@/components/ui";
import { HoldToConfirm } from "@/components/hold-to-confirm";
import { Composer } from "./social";
import styles from "./trade.module.css";

type Step = "edit" | "preview" | "sending" | "result";
type OrderType = "Market" | "Limit";
type Row = {
  k: string;
  note?: string;
  v: string;
  strong?: boolean;
  tone?: "neg";
};

/** A market order fails rather than fill more than 2¢ past its review. */
const SLIPPAGE = 2;
/** Typing settles this long before the ticket asks for a new quote. */
const QUOTE_DEBOUNCE_MS = 250;

/** A value that follows `value` once it stops changing for `ms`. */
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const other = (o: Outcome): Outcome => (o === "Yes" ? "No" : "Yes");
const cents = centsText;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour12: false });

/** Ticket state shared by the desktop panel and the phone sheet. */
function useTrade(market: Market, initialOutcome: Outcome, initialSide: Side) {
  const { state, services } = useDemo();
  const held = (o: Outcome) => availableShares(state, market.id, o);
  // Selling opens on the side you actually hold.
  const firstOutcome =
    initialSide === "Sell" &&
    !held(initialOutcome) &&
    held(other(initialOutcome))
      ? other(initialOutcome)
      : initialOutcome;
  const [side, setSideState] = useState<Side>(initialSide);
  const [outcome, setOutcome] = useState<Outcome>(firstOutcome);
  const [input, setInput] = useState(() =>
    initialSide === "Sell" ? String(held(firstOutcome) || "") : "100",
  );
  const [type, setTypeState] = useState<OrderType>("Market");
  const [limit, setLimit] = useState("");
  const [step, setStep] = useState<Step>("edit");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [moved, setMoved] = useState<{ from: number; quote: Quote } | null>(
    null,
  );
  const [orderId, setOrderId] = useState("");
  // One id per reviewed order: a retried send lands once.
  const clientOrderId = useRef("");
  const [submitError, setSubmitError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const buy = side === "Buy";
  const balance = availableCash(state);
  const holdings = held(outcome);
  const last = priceFor(market, outcome);
  const exec = buy ? bestAsk(market, outcome) : bestBid(market, outcome);
  const limitCents = /^\d{1,2}$/.test(limit.trim()) ? Number(limit) : NaN;
  const limitValid = limitCents >= 1 && limitCents <= 99;
  // A limit that crosses the book fills now, at the better book price.
  const crosses =
    type === "Limit" &&
    limitValid &&
    (buy ? limitCents >= exec : limitCents <= exec);
  const resting = type === "Limit" && !crosses;
  const price = resting && limitValid ? limitCents : exec;
  const position: Position | undefined = state.positions.find(
    (p) => p.marketId === market.id && p.outcome === outcome,
  );

  const ticket = (text: string): TicketRequest => ({
    marketId: market.id,
    side,
    outcome,
    type,
    input: text,
    ...(type === "Limit" && limitValid ? { limitCents } : {}),
  });
  // The server prices the ticket; while a new quote loads, the last one
  // for this ticket stays on screen.
  const settledInput = useSettled(input, QUOTE_DEBOUNCE_MS);
  let estimate: Quote | null = null;
  let quoting = false;
  let error = "";
  let blocked = "Fix the amount to continue";
  if (market.status !== "open") {
    // Resolved or halted: the ticket shows the market's state instead.
    blocked = "Trading is closed";
  } else if (!buy && !holdings) {
    error = `You don’t hold ${outcome} shares in this market.`;
    blocked = "Nothing to sell";
  } else if (type === "Limit" && !limitValid) {
    error = "Enter a limit price between 1¢ and 99¢.";
    blocked = "Fix the limit to continue";
  } else {
    try {
      const got =
        settledInput === input
          ? services.orders.preview(ticket(settledInput))
          : undefined;
      if (got) {
        estimate = got;
        // A buy is held to the amount typed, even when the book fills less.
        // Signed out there's no balance yet: the ticket prices, then asks
        // you to log in rather than saying you can't afford it.
        const asked = buy ? parseDollars(settledInput.replace(/[$,\s]/g, "")) : null;
        if (!state.signedOut) validateQuote(state, estimate, asked ?? undefined);
      } else {
        quoting = true;
        blocked = "Getting a price…";
        estimate = services.orders.latest(ticket(input)) ?? null;
      }
    } catch (e) {
      estimate = null;
      error = (e as Error).message;
    }
  }
  void price;

  const reset = () => {
    clearTimeout(timer.current);
    setStep("edit");
    setQuote(null);
    setMoved(null);
    setOrderId("");
    setSubmitError("");
    clientOrderId.current = "";
  };
  const setSide = (next: Side) => {
    reset();
    setSideState(next);
    if (next === "Sell") {
      const o =
        held(outcome) || !held(other(outcome)) ? outcome : other(outcome);
      setOutcome(o);
      setInput(String(held(o) || ""));
      if (type === "Limit") setLimit(String(bestAsk(market, o)));
    } else {
      setInput("100");
      if (type === "Limit") setLimit(String(bestBid(market, outcome)));
    }
  };
  const chooseOutcome = (o: Outcome) => {
    setOutcome(o);
    if (!buy) setInput(String(held(o) || ""));
    if (type === "Limit")
      setLimit(String(buy ? bestBid(market, o) : bestAsk(market, o)));
  };
  const setType = (next: OrderType) => {
    setTypeState(next);
    // A new limit joins the book: at the bid to buy, at the ask to sell.
    if (next === "Limit")
      setLimit(
        String(buy ? bestBid(market, outcome) : bestAsk(market, outcome)),
      );
  };
  const add = (dollars: number) => {
    const now = Number(input.replace(/[$,\s]/g, "")) || 0;
    setInput(String(Math.round((now + dollars) * 100) / 100));
  };
  const chips: [string, () => void][] = buy
    ? [
        ["+$10", () => add(10)],
        ["+$50", () => add(50)],
        ["+$100", () => add(100)],
        ["Max", () => setInput((balance / 100).toFixed(2))],
      ]
    : (
        [
          ["25%", 0.25],
          ["50%", 0.5],
          ["75%", 0.75],
          ["All", 1],
        ] as const
      ).map(([label, share]) => [
        label,
        () => setInput(String(Math.max(1, Math.floor(holdings * share)))),
      ]);

  const review = () => {
    if (!estimate || error || quoting) return;
    setQuote(estimate);
    setMoved(null);
    setSubmitError("");
    clientOrderId.current = crypto.randomUUID().replace(/-/g, "");
    setStep("preview");
  };
  const [sending, setSending] = useState(false);
  const place = async (reviewed: Quote | null = quote, accepted = false, postId?: string) => {
    if (!reviewed || sending) return;
    setSending(true);
    setSubmitError("");
    setStep("sending");
    try {
      const order = await services.orders.submit(ticket(input), {
        clientOrderId: clientOrderId.current || crypto.randomUUID().replace(/-/g, ""),
        expectedPriceCents: reviewed.priceCents,
        ...(postId ? { postId } : {}),
      });
      setQuote(reviewed);
      setMoved(null);
      setOrderId(order.id);
      setStep("result");
    } catch (e) {
      setStep("preview");
      // 05.6: the price moved past the slippage limit — ask again.
      if (e instanceof ApiRequestError && e.code === "price_moved" && !accepted) {
        const next = (e.details as { quote?: Quote } | undefined)?.quote;
        if (next) {
          setMoved({ from: reviewed.priceCents, quote: next });
          return;
        }
      }
      setSubmitError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const retryAsLimit = () => {
    reset();
    setTypeState("Limit");
    setLimit(String(exec));
  };
  const order = state.orders.find((o) => o.id === orderId);

  /** The edit and review rows, straight from the design's ledger. */
  const shown = step === "edit" ? estimate : quote;
  const dash = (value: string) => (shown ? value : "—");
  const venueNote = venueFeeNote(market.venueId, market.venueFee);
  const basisPart =
    shown && position && !buy
      ? Math.floor((position.costCents * shown.shares) / position.shares) +
        Math.floor((position.feeCents * shown.shares) / position.shares)
      : 0;
  const rows: Row[] = [
    { k: "Current price", note: "Last trade", v: `${last}¢` },
    resting
      ? {
          k: "Limit price",
          note: buy ? "The most you’ll pay" : "The least you’ll accept",
          v: limitValid ? `${limitCents}¢` : "—",
        }
      : {
          k: "Executable price",
          note:
            type === "Limit"
              ? `Your limit crosses the ${buy ? "ask" : "bid"} — fills now`
              : `Best ${buy ? "ask" : "bid"} on ${venueName(market.venueId)}`,
          v: `${exec}¢`,
        },
    ...(buy
      ? [
          { k: "Est. shares", v: dash(String(shown?.shares)) },
          {
            k: "Avg. price incl. fees",
            v: dash(
              shown
                ? cents(Math.round((shown.totalCents / shown.shares) * 10) / 10)
                : "",
            ),
          },
          {
            k: "Venue fee",
            note: venueNote,
            v: dash(usd(shown?.venueFeeCents ?? 0)),
          },
          {
            k: "App fee",
            note: "imo · 0.5%",
            v: dash(usd(shown?.appFeeCents ?? 0)),
          },
          {
            k: "Total cost",
            v: dash(usd(shown?.totalCents ?? 0)),
            strong: true,
          },
        ]
      : [
          {
            k: "Shares to sell",
            note: `You hold ${holdings.toLocaleString("en-US")}`,
            v: dash(String(shown?.shares)),
          },
          { k: "Gross proceeds", v: dash(usd(shown?.notionalCents ?? 0)) },
          {
            k: "Venue fee",
            note: venueNote,
            v: dash(`−${usd(shown?.venueFeeCents ?? 0)}`),
          },
          {
            k: "App fee",
            note: "imo · 0.5%",
            v: dash(`−${usd(shown?.appFeeCents ?? 0)}`),
          },
          {
            k: "Net proceeds",
            v: dash(usd(shown?.totalCents ?? 0)),
            strong: true,
          },
        ]),
  ];
  const realized = shown ? shown.totalCents - basisPart : 0;
  const outcomes: Row[] = buy
    ? [
        {
          k: `Payout if ${outcome}`,
          note: shown
            ? `${shown.shares.toLocaleString("en-US")} shares × $1.00 — includes your cost`
            : "Shares × $1.00 — includes your cost",
          v: dash(usd(shown?.payoutCents ?? 0)),
        },
        {
          k: `Profit if ${outcome}`,
          note: "Payout minus total cost",
          v: dash(
            signedUsd((shown?.payoutCents ?? 0) - (shown?.totalCents ?? 0)),
          ),
        },
        {
          k: "Max loss",
          note: `If the market resolves ${other(outcome)}`,
          v: dash(`−${usd(shown?.totalCents ?? 0)}`),
          tone: "neg",
        },
      ]
    : [
        {
          k: "Cost basis",
          note: position
            ? `avg ${cents(Math.round((position.costCents / position.shares) * 10) / 10)} entry, with fees`
            : "",
          v: dash(usd(basisPart)),
        },
        {
          k: "Realized P&L",
          note: "Net proceeds minus cost basis",
          v: dash(arrowUsd(realized)),
          tone: realized < 0 ? "neg" : undefined,
        },
        {
          k: "Remaining",
          note: "Still exposed to resolution",
          v: dash(
            `${(holdings - (shown?.shares ?? 0)).toLocaleString("en-US")} ${outcome}`,
          ),
        },
      ];
  const summary = quote
    ? `${side} ${quote.shares.toLocaleString("en-US")} ${outcome} ${resting && limitValid ? `· limit ${cents(limitCents)}` : `at ${cents(quote.priceCents)}`}`
    : "";

  return {
    state,
    services,
    side,
    buy,
    outcome,
    input,
    type,
    limit,
    step,
    quote,
    moved,
    order,
    quoting,
    sending,
    submitError,
    balance,
    holdings,
    last,
    exec,
    resting,
    estimate,
    error,
    blocked,
    rows,
    outcomes,
    summary,
    position,
    chips,
    setSide,
    chooseOutcome,
    setType,
    setInput: (value: string) => setInput(value),
    setLimit,
    review,
    place,
    edit: () => {
      setMoved(null);
      setSubmitError("");
      setStep("edit");
    },
    reset,
    retryAsLimit,
  };
}
type Trade = ReturnType<typeof useTrade>;

/** What actually filled on an order: its own shares, fees and total. */
function filledTotals(market: Market, order: Order) {
  const q = order.quote;
  // The server totals the real fills; older records fall back to the quote.
  if (order.filledTotalCents !== undefined) return order.filledTotalCents;
  if (order.filledShares === q.shares) return q.totalCents;
  const notional = order.filledShares * q.priceCents;
  const fees =
    venueFeeFor(market, order.filledShares, q.priceCents) + appFeeFor(notional);
  return q.side === "Buy" ? notional + fees : notional - fees;
}

function Ledger({ rows, notes = true }: { rows: Row[]; notes?: boolean }) {
  return (
    <dl className={styles.rows}>
      {rows.map((r) => (
        <div key={r.k} data-strong={r.strong || undefined}>
          <dt>
            {r.k}
            {notes && r.note && <span>{r.note}</span>}
          </dt>
          <dd data-tone={r.tone}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SideToggle({ t }: { t: Trade }) {
  return (
    <div className={styles.sideWrap}>
      <div className={styles.sideToggle} role="group" aria-label="Order side" data-indicator="pill">
        {(["Buy", "Sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={t.side === s}
            onClick={() => {
              if (t.side !== s) t.setSide(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 05.6 · the price moved past the limit: accept the new one or step back. */
function PriceMoved({ t, market }: { t: Trade; market: Market }) {
  if (!t.moved) return null;
  const q = t.moved.quote;
  return (
    <div className={styles.moved} role="alert">
      <b>Price moved to {cents(q.priceCents)}</b>
      <p>
        Your review was at {cents(t.moved.from)}. At {cents(q.priceCents)}{" "}
        {t.buy
          ? `you’d get ${q.shares.toLocaleString("en-US")} shares for ${usd(q.totalCents)} — payout if ${t.outcome} ${usd(q.payoutCents)}, profit ${signedUsd(q.payoutCents - q.totalCents)}.`
          : `you’d receive ${usd(q.totalCents)} for ${q.shares.toLocaleString("en-US")} shares on ${venueName(market.venueId)}.`}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => t.place(q, true)}
        >
          Accept {cents(q.priceCents)}
        </button>
        <button type="button" className="btn btn-secondary" onClick={t.edit}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** 05.7 – 05.10 · where an order stands, with what you can do about it. */
function OrderStatus({
  order,
  market,
  limit,
  onRetry,
  onNew,
  retryLabel,
}: {
  order: Order;
  market: Market;
  /** A limit rests on the book; a market order waits on the venue. */
  limit: boolean;
  onRetry: () => void;
  onNew: () => void;
  retryLabel: string;
}) {
  const { services } = useDemo();
  const q = order.quote;
  const what = `${q.side} ${q.shares.toLocaleString("en-US")} ${q.outcome} · ${market.shortTitle}`;
  const kinds = {
    pending: {
      Icon: Clock,
      title: "Order pending",
      tag: "tag-neutral",
      label: "Pending",
      body: `${what} ${limit ? `· limit ${cents(order.limitCents ?? q.priceCents)}. Resting on the book` : `at ${cents(q.priceCents)}. Waiting for a fill`}; ${
        q.side === "Buy"
          ? `${usd(q.totalCents)} is held until it fills.`
          : "those shares are held until it fills."
      }`,
    },
    partial: {
      Icon: CircleDashed,
      title: "Partially filled",
      tag: "tag-accent",
      label: "Partial",
      body: `${what} at ${cents(order.averagePriceCents ?? q.priceCents)}${order.averagePriceCents != null ? " average" : ""}. ${order.filledShares.toLocaleString("en-US")} filled; ${
        order.resting === false
          ? "the rest wasn’t available within 2¢ of the best price, so nothing more was spent."
          : "the rest is still working."
      }`,
    },
    failed: {
      Icon: CircleX,
      title: "Order failed",
      tag: "tag-outline",
      label: "Failed",
      body: `${what}. Not enough liquidity at market. No funds were used.`,
    },
    cancelled: {
      Icon: CircleX,
      title: "Order cancelled",
      tag: "tag-outline",
      label: "Cancelled",
      body: `${what}. ${
        order.filledShares
          ? `${order.filledShares.toLocaleString("en-US")} filled; the rest was released.`
          : "Nothing filled; everything held for it was released."
      }`,
    },
    filled: {
      Icon: CheckCircle,
      title: "Order filled",
      tag: "tag-neutral",
      label: "Filled",
      body: `${what} at ${cents(order.averagePriceCents ?? q.priceCents)}${order.averagePriceCents != null ? " average" : ""}. Total ${usd(filledTotals(market, order))} incl. fees.`,
    },
  } as const;
  const k = kinds[order.status];
  const pct = Math.round((order.filledShares / q.shares) * 100);
  return (
    <div className={styles.status} data-status={order.status}>
      <div className={styles.statusHead}>
        <k.Icon size={18} />
        <h3 tabIndex={-1} data-focus>
          {k.title}
        </h3>
        <span className={`tag ${k.tag}`}>{k.label}</span>
      </div>
      <p>{k.body}</p>
      <div
        className={styles.meter}
        role="progressbar"
        aria-label="Filled"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.statusMeta}>
        <span>
          {order.filledShares.toLocaleString("en-US")} /{" "}
          {q.shares.toLocaleString("en-US")} filled
        </span>
        <span>{clock(order.at)}</span>
      </div>
      <div className={styles.actions}>
        {order.status === "pending" && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => services.orders.cancel(order.id)}
          >
            Cancel order
          </button>
        )}
        {order.status === "partial" && order.resting !== false && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => services.orders.cancel(order.id)}
          >
            Cancel rest
          </button>
        )}
        {order.status === "failed" && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onNew}>
          New order
        </button>
      </div>
    </div>
  );
}

/** The filled order, then where it leaves you. */
function Filled({
  t,
  market,
  order,
  phone = false,
}: {
  t: Trade;
  market: Market;
  order: Order;
  phone?: boolean;
}) {
  const q = order.quote;
  const total = filledTotals(market, order);
  const after = t.state.positions.find(
    (p) => p.marketId === market.id && p.outcome === q.outcome,
  );
  const verb = q.side === "Buy" ? "Bought" : "Sold";
  const shares = order.filledShares.toLocaleString("en-US");
  // What the fills averaged, before fees: the server's, else the reviewed price.
  const price = cents(order.averagePriceCents ?? q.priceCents);
  const rows: Row[] = [
    {
      k: "Filled",
      v: `${shares} / ${q.shares.toLocaleString("en-US")} · ${clock(order.at)}`,
    },
    q.side === "Buy"
      ? { k: "Total paid incl. fees", v: usd(total) }
      : { k: "Net proceeds", v: usd(total) },
    {
      k: q.side === "Buy" ? "New position" : "Remaining position",
      v: after
        ? `${after.shares.toLocaleString("en-US")} ${after.outcome} · avg ${cents(Math.round((after.costCents / after.shares) * 10) / 10)}`
        : "None — position closed",
    },
    { k: "Available after", v: usd(availableCash(t.state)) },
  ];
  return (
    <>
      <div className={styles.doneHead}>
        <span className={styles.doneIcon} aria-hidden="true">
          <Check size={phone ? 24 : 16} />
        </span>
        {phone ? (
          <Dialog.Title className={styles.doneTitle} tabIndex={-1} data-focus>
            Order filled
          </Dialog.Title>
        ) : (
          <h3 className={styles.doneTitle} tabIndex={-1} data-focus>
            Order filled
          </h3>
        )}
      </div>
      <p className={styles.doneText}>
        {phone
          ? `${verb} ${shares} ${q.outcome} at ${price} in “${market.shortTitle}”.`
          : `${verb} ${shares} ${q.outcome} at ${price} · ${q.side === "Buy" ? "total" : "net"} ${usd(total)}${q.side === "Buy" ? " incl. fees" : ""}.`}
      </p>
      <Ledger rows={rows} notes={false} />
    </>
  );
}

/** Move focus to the new step's heading, so keyboard and screen reader
    users land where the ticket changed. */
function useStepFocus(step: Step, root: React.RefObject<HTMLElement | null>) {
  // Compare with the last step seen, so a remount (or React's development
  // double-run) never steals focus on arrival.
  const seen = useRef(step);
  useEffect(() => {
    if (seen.current === step) return;
    seen.current = step;
    root.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [step, root]);
}

/**
 * 04.1 · the live ticket: Buy / Sell, the outcome, market or limit, the
 * amount, its ledger and outcomes, then slide to review; review, sending
 * and the result follow in place.
 */
export function TradeTicket({
  market,
  initialOutcome = "Yes",
  initialSide = "Buy",
  sideToggle = true,
  outcomeToggle = true,
}: {
  market: Market;
  initialOutcome?: Outcome;
  initialSide?: Side;
  /** Off where the page already chooses the side (the position page). */
  sideToggle?: boolean;
  /** Off where the outcome is fixed: a position is one side of a market. */
  outcomeToggle?: boolean;
}) {
  const t = useTrade(market, initialOutcome, initialSide);
  const root = useRef<HTMLElement>(null);
  const [composer, setComposer] = useState(false);
  const [share, setShare] = useState(true);
  const shared = useRef("");
  const amountId = useId();
  const limitId = useId();
  const messageId = useId();
  const outcomeId = useId();
  useStepFocus(t.step, root);
  const order = t.order;
  // "Share this trade … after it fills": the composer opens on the fill,
  // since a prediction on Hunch always carries its reasoning.
  useEffect(() => {
    if (
      t.step === "result" &&
      share &&
      order &&
      order.filledShares > 0 &&
      shared.current !== order.id
    ) {
      shared.current = order.id;
      queueMicrotask(() => setComposer(true));
    }
  }, [t.step, share, order]);

  if (market.status !== "open")
    return (
      <section className={styles.ticket} aria-label="Market status">
        <div className={styles.body}>
          <MarketState market={market} />
        </div>
      </section>
    );
  return (
    <section ref={root} className={styles.ticket} aria-label="Trade ticket">
      {sideToggle && <SideToggle t={t} />}

      {t.step === "edit" && (
        <div className={styles.body}>
          <div className={styles.group} hidden={!outcomeToggle}>
            <span className={styles.label} id={outcomeId}>
              Outcome
            </span>
            <div
              className={styles.outcomes}
              role="group"
              aria-labelledby={outcomeId}
            >
              {(["Yes", "No"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  data-side={o}
                  aria-pressed={t.outcome === o}
                  onClick={() => t.chooseOutcome(o)}
                >
                  <b>
                    {o} {t.buy ? bestAsk(market, o) : bestBid(market, o)}¢
                  </b>
                  <span>
                    {t.buy
                      ? `Ask · last ${priceFor(market, o)}¢`
                      : `Bid · you hold ${availableShares(t.state, market.id, o).toLocaleString("en-US")}`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.typeRow}>
            <div
              className={styles.typeSeg} data-indicator="pill"
              role="group"
              aria-label="Order type"
            >
              {(["Market", "Limit"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={t.type === k}
                  onClick={() => t.setType(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <span>
              {t.buy
                ? `Available ${usd(t.balance)}`
                : `Holding ${t.holdings.toLocaleString("en-US")} ${t.outcome}`}
            </span>
          </div>

          {t.type === "Limit" && (
            <div className={styles.group}>
              <label className={styles.fieldLabel} htmlFor={limitId}>
                Limit price
              </label>
              <div className={styles.amount} data-size="sm">
                <input
                  id={limitId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={t.limit}
                  onChange={(e) => t.setLimit(e.target.value)}
                />
                <span aria-hidden="true">¢ per share</span>
              </div>
            </div>
          )}

          <div className={styles.group}>
            <label className={styles.fieldLabel} htmlFor={amountId}>
              {t.buy ? "Amount (USD)" : "Shares to sell"}
            </label>
            <div
              className={styles.amount}
              data-invalid={!!t.error || undefined}
            >
              <span className={styles.prefix} aria-hidden="true">
                {t.buy ? "$" : "#"}
              </span>
              <input
                id={amountId}
                inputMode={t.buy ? "decimal" : "numeric"}
                autoComplete="off"
                value={t.input}
                onChange={(e) => t.setInput(e.target.value)}
                aria-invalid={!!t.error}
                aria-describedby={messageId}
                data-focus
              />
              <span aria-hidden="true">{t.buy ? "USD" : "shares"}</span>
            </div>
            <p id={messageId} className={styles.error} aria-live="polite">
              {t.error && (
                <>
                  <WarningCircle size={14} />
                  <span>{t.error}</span>
                </>
              )}
            </p>
            {t.buy && t.error.startsWith("Insufficient") && (
              <button
                type="button"
                className={`btn btn-secondary ${styles.useMax}`}
                onClick={() => t.setInput((t.balance / 100).toFixed(2))}
              >
                Use max {usd(t.balance)}
              </button>
            )}
          </div>

          <div className={styles.chips}>
            {t.chips.map(([label, run]) => (
              <button
                key={label}
                type="button"
                className="btn btn-secondary"
                onClick={run}
              >
                {label}
              </button>
            ))}
          </div>

          <Ledger rows={t.rows} />
          <div className={styles.box}>
            <Ledger rows={t.outcomes} />
          </div>

          {/* In reach on a short screen: the slider stays at the bottom of
              the column while the breakdown scrolls under it. */}
          <div className={styles.stickyCta}>
            {t.state.signedOut ? (
              <Button variant="primary" className={styles.logIn} onClick={() => t.services.auth.prompt("trade")}>
                Log in to trade
              </Button>
            ) : (
              <SwipeToReview
                key={`${t.side}-${t.outcome}`}
                disabled={!!t.error || t.quoting}
                blockedLabel={t.blocked}
                onComplete={t.review}
              />
            )}
          </div>
          <p className={styles.fine}>
            {t.resting
              ? `A limit rests on the ${venueName(market.venueId)} book until it fills or you cancel it; ${t.buy ? "its cost is held" : "its shares are held"} meanwhile. Simulated funds.`
              : `Paper account — simulated funds, filled against the live ${venueName(market.venueId)} book. Executable price can differ from the last price; the order fails rather than filling beyond a ${SLIPPAGE}¢ move.`}
          </p>
        </div>
      )}

      {t.step === "preview" && t.quote && (
        <div className={styles.body}>
          <span className={styles.label}>Review order</span>
          <h3 className={styles.summary} tabIndex={-1} data-focus>
            {t.summary}
          </h3>
          <span className={styles.sub}>
            {market.shortTitle} · {venueName(market.venueId)}
          </span>
          <div className={styles.review}>
            <Ledger rows={t.rows} notes={false} />
            <Ledger
              rows={t.outcomes.map((r) => ({ ...r, strong: true }))}
              notes={false}
            />
          </div>
          <PriceMoved t={t} market={market} />
          {t.submitError && (
            <p className={styles.error} role="alert">
              <WarningCircle size={14} />
              <span>{t.submitError}</span>
            </p>
          )}
          {!t.moved && (
            <>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={share}
                  onChange={(e) => setShare(e.target.checked)}
                />
                Share this trade to my feed after it fills
              </label>
              <button
                type="button"
                className={`btn btn-primary btn-split ${styles.place}`}
                onClick={() => t.place()}
              >
                <span>Place order</span>
                <Check size={16} />
              </button>
              <button
                type="button"
                className={`btn btn-secondary ${styles.start}`}
                onClick={t.edit}
              >
                Edit
              </button>
            </>
          )}
        </div>
      )}

      {t.step === "sending" && (
        <div className={styles.body} role="status">
          <div className={styles.sending}>
            <Spinner size={20} className={styles.spin} />
            <b>Placing your paper order…</b>
          </div>
          <div className={styles.meter} data-running aria-hidden="true">
            <span />
          </div>
          <span className={styles.muted}>
            Filling against {venueName(market.venueId)}’s live order book. You
            can leave this page — the order is already placed.
          </span>
        </div>
      )}

      {t.step === "result" && order && (
        <div className={styles.body}>
          {order.status === "filled" ? (
            <>
              <Filled t={t} market={market} order={order} />
              <Link
                href="/portfolio"
                className={`btn btn-primary btn-split ${styles.cta44}`}
              >
                <span>View in portfolio</span>
                <ArrowRight size={16} />
              </Link>
              <button
                type="button"
                className={`btn btn-secondary ${styles.start}`}
                onClick={() => setComposer(true)}
              >
                <PencilSimpleLine size={15} />
                Post your reasoning
              </button>
              <button
                type="button"
                className={`btn btn-ghost ${styles.start}`}
                onClick={t.reset}
              >
                New order
              </button>
            </>
          ) : (
            <OrderStatus
              order={order}
              market={market}
              limit={t.type === "Limit"}
              retryLabel="Retry as limit"
              onRetry={t.retryAsLimit}
              onNew={t.reset}
            />
          )}
        </div>
      )}

      <Composer
        key={`${composer}`}
        open={composer}
        onOpenChange={setComposer}
        marketId={market.id}
        initialOutcome={order?.quote.outcome ?? t.outcome}
      />
    </section>
  );
}

/**
 * 05.1 – 05.3 · the phone flow: an amount sheet, a review sheet with a
 * press-and-hold confirm, and the filled order full screen.
 */
export function TradeSheet({
  market,
  open,
  onOpenChange,
  initialOutcome = "Yes",
  initialSide = "Buy",
}: {
  market: Market;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialOutcome?: Outcome;
  initialSide?: Side;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [composer, setComposer] = useState(false);
  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.scrim} />
          <Dialog.Content
            className={styles.sheet}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              returnFocus.current = document.activeElement as HTMLElement;
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (returnFocus.current?.isConnected) returnFocus.current.focus();
            }}
          >
            <SheetBody
              market={market}
              initialOutcome={initialOutcome}
              initialSide={initialSide}
              onReasoning={() => {
                onOpenChange(false);
                setComposer(true);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Composer
        key={`${composer}`}
        open={composer}
        onOpenChange={setComposer}
        marketId={market.id}
        initialOutcome={initialOutcome}
      />
    </>
  );
}

function SheetBody({
  market,
  initialOutcome,
  initialSide,
  onReasoning,
}: {
  market: Market;
  initialOutcome: Outcome;
  initialSide: Side;
  onReasoning: () => void;
}) {
  const t = useTrade(market, initialOutcome, initialSide);
  const root = useRef<HTMLDivElement>(null);
  const amountId = useId();
  const messageId = useId();
  useStepFocus(t.step, root);
  const order = t.order;
  const q = t.step === "edit" ? t.estimate : t.quote;
  const dash = (v: string) => (q ? v : "—");
  const done = t.step === "result" && order?.status === "filled";

  let content: ReactNode;
  if (t.step === "edit")
    content = (
      <>
        <header className={styles.sheetHead}>
          <Dialog.Title className={styles.sheetTitle}>
            {t.side} · {market.shortTitle}
          </Dialog.Title>
          <Dialog.Close className={styles.iconBtn} aria-label="Close">
            <X size={20} />
          </Dialog.Close>
        </header>
        <div className={styles.sheetBody}>
          <div className={styles.bigOutcomes} role="group" aria-label="Outcome">
            {(["Yes", "No"] as const).map((o) => (
              <button
                key={o}
                type="button"
                data-side={o}
                aria-pressed={t.outcome === o}
                onClick={() => t.chooseOutcome(o)}
              >
                <b>
                  {o} {t.buy ? bestAsk(market, o) : bestBid(market, o)}¢
                </b>
                <span>{t.outcome === o ? "Selected" : "Tap to switch"}</span>
              </button>
            ))}
          </div>
          <div className={styles.big} data-invalid={!!t.error || undefined}>
            <span aria-hidden="true">{t.buy ? "$" : "#"}</span>
            <input
              id={amountId}
              aria-label={t.buy ? "Amount" : "Shares to sell"}
              inputMode={t.buy ? "decimal" : "numeric"}
              autoComplete="off"
              value={t.input}
              onChange={(e) => t.setInput(e.target.value)}
              aria-invalid={!!t.error}
              aria-describedby={messageId}
              data-focus
            />
            <span className={styles.avail}>
              {t.buy
                ? `Avail. ${usd(t.balance)}`
                : `Holding ${t.holdings.toLocaleString("en-US")}`}
            </span>
          </div>
          <p id={messageId} className={styles.error} aria-live="polite">
            {t.error && (
              <>
                <WarningCircle size={14} />
                <span>{t.error}</span>
              </>
            )}
          </p>
          <div className={styles.bigChips}>
            {t.chips.map(([label, run]) => (
              <button
                key={label}
                type="button"
                className="btn btn-secondary"
                onClick={run}
              >
                {label}
              </button>
            ))}
          </div>
          <dl className={styles.compact}>
            <div>
              <dt>
                Executable price <span>(last {t.last}¢)</span>
              </dt>
              <dd>{t.exec}¢</dd>
            </div>
            <div>
              <dt>{t.buy ? "Est. shares" : "Shares to sell"}</dt>
              <dd>{dash(String(q?.shares.toLocaleString("en-US")))}</dd>
            </div>
            <div>
              <dt>
                Fees ·{" "}
                {market.venueFee.kind !== "none"
                  ? `${venueName(market.venueId)} ${dash(usd(q?.venueFeeCents ?? 0))} + `
                  : ""}
                app {dash(usd(q?.appFeeCents ?? 0))}
              </dt>
              <dd>{dash(`${t.buy ? "" : "−"}${usd(q?.feeCents ?? 0)}`)}</dd>
            </div>
            <div data-strong>
              <dt>{t.buy ? "Total cost" : "Net proceeds"}</dt>
              <dd>{dash(usd(q?.totalCents ?? 0))}</dd>
            </div>
          </dl>
          <dl className={styles.strip}>
            {t.outcomes.map((r) => (
              <div key={r.k}>
                <dt>{r.k}</dt>
                <dd data-tone={r.tone}>{r.v}</dd>
              </div>
            ))}
          </dl>
          {t.state.signedOut ? (
            <Button variant="primary" className={styles.logIn} onClick={() => t.services.auth.prompt("trade")}>
              Log in to trade
            </Button>
          ) : (
            <SwipeToReview
              key={`${t.side}-${t.outcome}`}
              disabled={!!t.error || t.quoting}
              blockedLabel={t.blocked}
              onComplete={t.review}
            />
          )}
        </div>
      </>
    );
  else if (t.step === "preview" && t.quote) {
    const tq = t.quote;
    content = (
      <>
        <header className={styles.sheetHead} data-back>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Back to amount"
            onClick={t.edit}
          >
            <CaretLeft size={20} />
          </button>
          <Dialog.Title className={styles.sheetTitle}>
            Review order
          </Dialog.Title>
        </header>
        <div className={styles.sheetBody}>
          <h3 className={styles.sheetSummary} tabIndex={-1} data-focus>
            {t.summary}
          </h3>
          <span className={styles.sub}>
            {market.title} · {venueName(market.venueId)}
          </span>
          <dl className={styles.compact} data-roomy>
            <div>
              <dt>Shares × executable price</dt>
              <dd>{usd(tq.notionalCents)}</dd>
            </div>
            <div>
              <dt>Venue fee · {venueName(market.venueId)}</dt>
              <dd>
                {t.buy ? "" : "−"}
                {usd(tq.venueFeeCents)}
              </dd>
            </div>
            <div>
              <dt>App fee · imo 0.5%</dt>
              <dd>
                {t.buy ? "" : "−"}
                {usd(tq.appFeeCents)}
              </dd>
            </div>
            <div data-strong data-rule>
              <dt>{t.buy ? "Total cost" : "Net proceeds"}</dt>
              <dd>{usd(tq.totalCents)}</dd>
            </div>
            {t.buy ? (
              <>
                <div>
                  <dt>
                    Payout if {t.outcome}{" "}
                    <span>({tq.shares.toLocaleString("en-US")} × $1.00)</span>
                  </dt>
                  <dd>
                    <b>{usd(tq.payoutCents)}</b>
                  </dd>
                </div>
                <div>
                  <dt>Profit if {t.outcome}</dt>
                  <dd>
                    <b>{signedUsd(tq.payoutCents - tq.totalCents)}</b>
                  </dd>
                </div>
                <div>
                  <dt>Max loss if {other(t.outcome)}</dt>
                  <dd data-tone="neg">
                    <b>−{usd(tq.totalCents)}</b>
                  </dd>
                </div>
              </>
            ) : (
              t.outcomes.map((r) => (
                <div key={r.k}>
                  <dt>{r.k}</dt>
                  <dd data-tone={r.tone}>
                    <b>{r.v}</b>
                  </dd>
                </div>
              ))
            )}
          </dl>
          <span className={styles.note}>
            Fails if the price moves{" "}
            {t.buy
              ? `above ${Math.min(99, tq.priceCents + SLIPPAGE)}¢`
              : `below ${Math.max(1, tq.priceCents - SLIPPAGE)}¢`}{" "}
            before filling. Simulated funds.
          </span>
          <PriceMoved t={t} market={market} />
          {t.submitError && (
            <p className={styles.error} role="alert">
              <WarningCircle size={14} />
              <span>{t.submitError}</span>
            </p>
          )}
          {!t.moved && (
            <HoldToConfirm label="Place order" onConfirm={() => t.place()}>
              <span>Place order · hold to confirm</span>
              <Check size={16} />
            </HoldToConfirm>
          )}
        </div>
      </>
    );
  } else if (t.step === "sending")
    content = (
      <>
        <header className={styles.sheetHead}>
          <Dialog.Title className={styles.sheetTitle}>
            Review order
          </Dialog.Title>
        </header>
        <div className={styles.sheetBody} role="status">
          <div className={styles.sending}>
            <Spinner size={20} className={styles.spin} />
            <b>Placing your paper order…</b>
          </div>
          <div className={styles.meter} data-running aria-hidden="true">
            <span />
          </div>
          <span className={styles.muted}>
            Filling against {venueName(market.venueId)}’s live order book. You
            can leave this page — the order is already placed.
          </span>
        </div>
      </>
    );
  else if (done && order)
    content = (
      <div className={styles.done}>
        <Dialog.Close
          className={`${styles.iconBtn} ${styles.doneClose}`}
          aria-label="Close"
        >
          <X size={20} />
        </Dialog.Close>
        <Filled t={t} market={market} order={order} phone />
        <span className={styles.flex} />
        <Link
          href="/portfolio"
          className={`btn btn-primary btn-split ${styles.cta52}`}
        >
          <span>View portfolio</span>
          <ArrowRight size={16} />
        </Link>
        <button
          type="button"
          className={`btn btn-secondary ${styles.cta52} ${styles.start}`}
          onClick={onReasoning}
        >
          <PencilSimpleLine size={15} />
          Post your reasoning
        </button>
      </div>
    );
  else if (order)
    content = (
      <>
        <header className={styles.sheetHead}>
          <Dialog.Title className={styles.sheetTitle}>
            Order status
          </Dialog.Title>
          <Dialog.Close className={styles.iconBtn} aria-label="Close">
            <X size={20} />
          </Dialog.Close>
        </header>
        <div className={styles.sheetBody}>
          <OrderStatus
            order={order}
            market={market}
            limit={t.type === "Limit"}
            retryLabel="Try again"
            onRetry={t.reset}
            onNew={t.reset}
          />
        </div>
      </>
    );

  return (
    <div
      ref={root}
      className={styles.sheetInner}
      data-step={done ? "done" : t.step}
    >
      {!done && <div className={styles.grabber} aria-hidden="true" />}
      {content}
    </div>
  );
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * 04.4 – 04.6 · a market that no longer trades: halted and awaiting its
 * source, or resolved — with your payout to claim, or what it came to.
 */
export function MarketState({ market }: { market: Market }) {
  const { state, services } = useDemo();
  const held = state.positions.filter((p) => p.marketId === market.id);
  const closed = state.closed.filter((p) => p.marketId === market.id);
  const date = shortDate(market.closesAt);
  if (market.status === "closed")
    return (
      <div className={styles.state}>
        <div className={styles.stateTags}>
          <span className="tag tag-neutral">
            <Lock size={12} />
            Closed
          </span>
          <span className="tag tag-neutral">{date} · awaiting source</span>
        </div>
        <b className={styles.stateTitle}>{market.shortTitle}</b>
        {/* The sides stay in view, but can't be traded while halted. */}
        <div className={styles.stateSides}>
          <button type="button" data-side="Yes" disabled>
            Yes {market.yesPrice}¢
          </button>
          <button type="button" data-side="No" disabled>
            No {complement(market.yesPrice)}¢
          </button>
        </div>
        <p className={styles.muted}>
          Trading halted. Last price {market.yesPrice}¢ is not a result.
          Expected resolution within 48h.
        </p>
        {held.map((p) => (
          <p key={p.id} className={styles.stateNote}>
            You hold {p.shares.toLocaleString("en-US")} {p.outcome}. Each pays
            $1.00 if it resolves {p.outcome}.
          </p>
        ))}
      </div>
    );
  const winner = market.resolution.outcome ?? "Yes";
  return (
    <div className={styles.state}>
      <div className={styles.stateTags}>
        <span className="tag" data-strong>
          <Flag size={12} />
          Resolved · {winner}
        </span>
        <span className="tag tag-neutral">{date}</span>
      </div>
      <b className={styles.stateTitle}>{market.shortTitle}</b>
      {held.map((p) => {
        const won = p.outcome === winner;
        const payout = won ? p.shares * 100 : 0;
        const basis = p.costCents + p.feeCents;
        return (
          <div key={p.id} className={styles.stateBody}>
            <dl className={styles.stateGrid}>
              <dt>
                You hold {p.shares.toLocaleString("en-US")} {p.outcome}
              </dt>
              <dd>Payout {usd(payout)}</dd>
              <dt className={styles.muted}>Cost basis {usd(basis)}</dt>
              <dd data-tone={payout - basis < 0 ? "neg" : undefined}>
                {won
                  ? `Profit ${signedUsd(payout - basis)}`
                  : `▼ Realized ${signedUsd(payout - basis)}`}
              </dd>
            </dl>
            {won ? (
              <button
                type="button"
                className="btn btn-primary btn-split"
                onClick={() => services.portfolio.claim(p.id)}
              >
                <span>Claim {usd(payout)}</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => services.portfolio.claim(p.id)}
              >
                Close position
              </button>
            )}
          </div>
        );
      })}
      {!held.length &&
        closed.map((c) => {
          const claimed = c.exitFeeCents === 0;
          const basis = c.costCents + c.feeCents;
          const net = c.proceedsCents - c.exitFeeCents;
          return (
            <div key={c.id} className={styles.stateBody}>
              <dl className={styles.stateGrid}>
                <dt>
                  {claimed
                    ? `You claimed ${c.shares.toLocaleString("en-US")} ${c.outcome}`
                    : `You sold ${c.shares.toLocaleString("en-US")} ${c.outcome} at ${cents(Math.round((c.proceedsCents / c.shares) * 10) / 10)}`}
                </dt>
                <dd>Payout {usd(claimed ? c.proceedsCents : 0)}</dd>
                <dt className={styles.muted}>Cost basis {usd(basis)}</dt>
                <dd data-tone={net - basis < 0 ? "neg" : undefined}>
                  {arrowUsd(net - basis).replace(/^(▲|▼) /, "$1 Realized ")}
                </dd>
              </dl>
              <p className={styles.muted}>
                {claimed
                  ? "Paid to your cash. Recorded in closed positions."
                  : "Nothing to claim. Recorded in closed positions."}
              </p>
            </div>
          );
        })}
      {!held.length && !closed.length && (
        <p className={styles.muted}>
          Each {winner} share paid $1.00; each {other(winner)} share paid
          nothing. Trading has ended.
        </p>
      )}
    </div>
  );
}
