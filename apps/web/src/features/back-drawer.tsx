"use client";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError } from "@/client/http";
import { useDemo } from "@/services/provider";
import { useMediaQuery } from "@/components/use-media-query";
import { SwipeToReview } from "@/components/swipe-to-review";
import { Avatar } from "@/components/ui";
import {
  ArrowRight,
  ChatCircle,
  Check,
  CircleX,
  Spinner,
  WarningCircle,
  X,
} from "@/components/icons";
import {
  accuracy,
  availableCash,
  bestAsk,
  bestBid,
  validateQuote,
} from "@imo/domain/engine";
import { arrowUsd, centsText, parseDollars, priceFor, signedUsd, usd, tone, signedPct } from "@imo/domain/money";
import type { Order, Outcome, Post, Quote } from "@imo/domain/types";
import { venueName } from "@/data/venues";
import styles from "./back-drawer.module.css";

type Step = "edit" | "preview" | "submitting" | "done";
const CHIPS = ["25", "50", "100", "250"];

/** How an order came back, in a few words. */
const outcomeTitle = (order: Order) =>
  order.status === "filled"
    ? "Order filled"
    : order.status === "partial"
      ? "Partly filled"
      : order.status === "pending"
        ? "Order placed"
        : "Order didn’t fill";

/** What actually filled: shares, the average price and the real total. */
function outcomeText(order: Order, outcome: Outcome) {
  const asked = order.quote.shares;
  const avg = order.averagePriceCents;
  const total = order.filledTotalCents;
  const bought =
    order.filledShares > 0
      ? `Bought ${order.filledShares.toLocaleString()}${
          order.filledShares < asked ? ` of ${asked.toLocaleString()}` : ""
        } ${outcome}${avg != null ? ` at ${centsText(avg)} average` : ""}${
          total !== undefined ? ` · ${usd(total)} incl. fees` : ""
        }.`
      : "";
  if (order.status === "filled") return bought;
  if (order.status === "partial")
    return `${bought} ${
      order.resting === false
        ? "The rest wasn’t available near the best price, so nothing more was spent."
        : "The rest is still working."
    }`;
  if (order.status === "pending") return "It’s working on the book; you’ll be notified when it fills.";
  return order.reason ?? "Not enough liquidity at market. No funds were used.";
}

/**
 * Back or Fade a post: a prefilled ticket with the trader's record beside
 * it. Desktop floats a 400px drawer over the panels (06.1); phones get the
 * 06.3 bottom sheet. Either way it is the reader's own order — never a copy.
 */
export function BackDrawer({
  post,
  initialOutcome,
  container,
  onClose,
}: {
  post: Post;
  initialOutcome: Outcome;
  /** The panels element the desktop drawer and its scrim are laid over. */
  container: HTMLElement | null;
  onClose: () => void;
}) {
  const { state, services } = useDemo();
  const phone = useMediaQuery("(max-width: 600px)");
  const trader = services.profiles.get(post.authorId)!;
  const market = services.markets.get(post.marketId)!;
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [amount, setAmount] = useState("100");
  const [step, setStep] = useState<Step>("edit");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [placed, setPlaced] = useState<Order | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const amountId = useId();
  const errorId = useId();
  useEffect(() => {
    if (step !== "edit") stepHeading.current?.focus();
  }, [step]);

  const first = trader.name.split(" ")[0];
  const same = outcome === post.outcome;
  const stat = trader.stats["30D"];
  const available = availableCash(state);
  const disclosed = post.disclosePosition && post.evidenceShares > 0;
  const theirPnl = disclosed
    ? (bestBid(market, post.outcome) - post.entryPrice) * post.evidenceShares
    : 0;

  // Validate as they type; the design's copy for each failure.
  const raw = amount.replace(/[$,\s]/g, "");
  let estimate: Quote | null = null;
  let error = "";
  if (!raw || !/^\d*\.?\d*$/.test(raw) || raw === ".")
    error = "Enter an amount in dollars.";
  else {
    const cents = parseDollars(raw);
    if (cents === null) error = "Use dollars and cents — up to two decimals.";
    else if (cents < 100) error = "Minimum order is $1.00.";
    // Signed out there's no balance yet: price it, then ask to log in.
    else if (cents > available && !state.signedOut)
      error = `Insufficient balance — ${usd(available)} available.`;
    else {
      try {
        // Priced by the server on the live book, like the full ticket.
        estimate =
          services.orders.preview({ marketId: market.id, side: "Buy", outcome, type: "Market", input: raw }) ?? null;
        if (estimate && !state.signedOut) validateQuote(state, estimate);
      } catch (e) {
        estimate = null;
        error = (e as Error).message;
      }
    }
  }
  const shown = step === "edit" ? estimate : quote;
  const dash = (value: string) => (shown ? value : "—");
  const venue = venueName(market.venueId);
  const rows = shown
    ? [
        { k: "Current price", v: `${priceFor(market, outcome)}¢` },
        { k: "Executable price", v: centsText(shown.priceCents) },
        { k: "Est. shares", v: shown.shares.toLocaleString() },
        { k: `Venue fee · ${venue}`, v: usd(shown.venueFeeCents) },
        { k: "App fee · imo 0.5%", v: usd(shown.appFeeCents) },
        { k: "Total cost", v: usd(shown.totalCents), strong: true },
      ]
    : [
        { k: "Current price", v: `${priceFor(market, outcome)}¢` },
        { k: "Executable price", v: `${bestAsk(market, outcome)}¢` },
        { k: "Est. shares", v: "—" },
        { k: `Venue fee · ${venue}`, v: "—" },
        { k: "App fee · imo 0.5%", v: "—" },
        { k: "Total cost", v: "—", strong: true },
      ];
  const outcomes = [
    { k: `Payout if ${outcome}`, v: dash(shown ? usd(shown.payoutCents) : "") },
    {
      k: `Profit if ${outcome}`,
      v: dash(shown ? signedUsd(shown.payoutCents - shown.totalCents) : ""),
    },
    {
      k: "Max loss",
      v: dash(shown ? `−${usd(shown.totalCents)}` : ""),
      negative: true,
    },
  ];

  const clientOrderId = useRef("");
  const review = () => {
    if (!estimate || error) return;
    setQuote(estimate);
    setSubmitError("");
    clientOrderId.current = crypto.randomUUID().replace(/-/g, "");
    setStep("preview");
  };
  const place = async () => {
    if (!quote) return;
    setStep("submitting");
    try {
      setPlaced(
        await services.orders.submit(
          { marketId: market.id, side: "Buy", outcome, type: "Market", input: raw },
          { clientOrderId: clientOrderId.current, expectedPriceCents: quote.priceCents, postId: post.id },
        ),
      );
      setStep("done");
    } catch (e) {
      setSubmitError(
        e instanceof ApiRequestError && e.code === "price_moved"
          ? "The price moved since you reviewed it. Check the new price and try again."
          : (e as Error).message,
      );
      setStep("edit");
    }
  };
  const pick = (next: Outcome) => {
    setOutcome(next);
    setStep("edit");
  };
  const title = `${same ? "Back" : "Fade"} ${phone ? trader.name : first} · ${outcome}`;

  const pills = (
    <div className={styles.outcomes} role="group" aria-label="Outcome">
      {(["Yes", "No"] as const).map((o) => (
        <button
          key={o}
          type="button"
          className={styles.outcome}
          data-side={o}
          aria-pressed={outcome === o}
          onClick={() => pick(o)}
        >
          <b>
            {o} {bestAsk(market, o)}¢
          </b>
          <span>
            {o === post.outcome ? `Same side as ${first}` : `Fade ${first}`}
          </span>
        </button>
      ))}
    </div>
  );
  const invalid = Boolean(error) || Boolean(submitError);
  // The server hasn't priced it yet: nothing to review.
  const quoting = !invalid && !estimate;
  const message = submitError || error;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={phone ? undefined : container}>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          ref={content}
          className={styles.drawer}
          data-step={step}
          onOpenAutoFocus={(event) => {
            // Land on the dialog itself so its title is announced first.
            returnFocus.current = document.activeElement as HTMLElement;
            event.preventDefault();
            content.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
          tabIndex={-1}
        >
          <div className={styles.grabber} aria-hidden="true" />
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close
              className={`btn btn-icon ${styles.close}`}
              aria-label="Close dialog"
            >
              <X size={phone ? 20 : 15} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            Your own simulated order on {market.title}, beside {trader.name}’s
            record. Review the price and fees before you place it.
          </Dialog.Description>

          <div className={styles.body}>
            {phone ? (
              <section className={styles.quote} aria-label="Their call">
                <p>
                  “{post.text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "")}…”
                </p>
                <dl>
                  <div>
                    <dt>Right</dt>
                    <dd>
                      <b>{accuracy(stat)}%</b> · {stat.resolved}
                    </dd>
                  </div>
                  <div>
                    <dt>P&amp;L 30d</dt>
                    <dd>
                      <b>{signedUsd(stat.pnlCents)}</b>
                    </dd>
                  </div>
                  <div>
                    <dt>On this trade</dt>
                    <dd>
                      <b
                        className={
                          disclosed
                            ? theirPnl >= 0
                              ? "positive"
                              : "negative"
                            : undefined
                        }
                      >
                        {disclosed ? arrowUsd(theirPnl) : "—"}
                      </b>
                    </dd>
                  </div>
                </dl>
              </section>
            ) : (
              <section className={styles.source} aria-label="Their record">
                <div className={styles.sourceHead}>
                  <Avatar trader={trader} size={32} />
                  <span>
                    <b>{trader.name}</b>
                    <span>
                      {disclosed ? (
                        <>
                          Holds {post.evidenceShares.toLocaleString()}{" "}
                          {post.outcome} @ {post.entryPrice}¢ ·{" "}
                          <b
                            className={tone(theirPnl)}
                          >
                            {arrowUsd(theirPnl)}
                          </b>
                        </>
                      ) : (
                        `Predicts ${post.outcome} · no position disclosed`
                      )}
                    </span>
                  </span>
                  <Link href={`/trader/${trader.id}`}>Profile</Link>
                </div>
                <dl className={styles.sourceStats}>
                  <div>
                    <dt>Right</dt>
                    <dd>{accuracy(stat)}%</dd>
                    <dt>{stat.resolved} resolved</dt>
                  </div>
                  <div>
                    <dt>P&amp;L 30d</dt>
                    <dd
                      className={tone(stat.pnlCents)}
                    >
                      {signedUsd(stat.pnlCents)}
                    </dd>
                    <dt>net of fees</dt>
                  </div>
                  <div>
                    <dt>ROI</dt>
                    <dd
                      className={tone(stat.returnPct)}
                    >
                      {signedPct(stat.returnPct)}
                    </dd>
                    <dt>{trader.focus}</dt>
                  </div>
                </dl>
                <Link
                  href={`/market/${market.id}`}
                  className={styles.sourceMarket}
                >
                  {market.title} ↗
                </Link>
              </section>
            )}

            {step === "edit" && (
              <div className={styles.step}>
                {pills}
                {phone ? (
                  <label className={styles.bigAmount} htmlFor={amountId}>
                    <span aria-hidden="true">$</span>
                    <input
                      id={amountId}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setSubmitError("");
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label="Amount in dollars"
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    <small>Avail. {usd(available)}</small>
                  </label>
                ) : (
                  <label
                    className={styles.amount}
                    data-invalid={invalid || undefined}
                    htmlFor={amountId}
                  >
                    <span aria-hidden="true">$</span>
                    <input
                      id={amountId}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setSubmitError("");
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label="Amount in dollars"
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    <small>Avail. {usd(available)}</small>
                  </label>
                )}
                {message && (
                  <p className={styles.error} id={errorId} role="alert">
                    <WarningCircle size={14} />
                    {message}
                  </p>
                )}
                {!phone && (
                  <div className={styles.chips}>
                    {CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="btn btn-secondary"
                        aria-pressed={raw === chip}
                        onClick={() => {
                          setAmount(chip);
                          setSubmitError("");
                        }}
                      >
                        ${chip}
                      </button>
                    ))}
                  </div>
                )}
                {phone ? (
                  <dl className={styles.rows}>
                    <div>
                      <dt>
                        Executable{" "}
                        <span>(last {priceFor(market, outcome)}¢)</span>
                      </dt>
                      <dd>{bestAsk(market, outcome)}¢</dd>
                    </div>
                    <div>
                      <dt>Est. shares</dt>
                      <dd>
                        {dash(shown ? shown.shares.toLocaleString() : "")}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {shown
                          ? `Fees · ${venue} ${usd(shown.venueFeeCents)} + app ${usd(shown.appFeeCents)}`
                          : "Fees"}
                      </dt>
                      <dd>{dash(shown ? usd(shown.feeCents) : "")}</dd>
                    </div>
                    <div data-strong>
                      <dt>Total cost</dt>
                      <dd>{dash(shown ? usd(shown.totalCents) : "")}</dd>
                    </div>
                  </dl>
                ) : (
                  <dl className={styles.rows}>
                    {rows.map((r) => (
                      <div key={r.k} data-strong={r.strong || undefined}>
                        <dt>{r.k}</dt>
                        <dd>{r.v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <dl className={styles.payoff}>
                  {outcomes.map((r) => (
                    <div key={r.k}>
                      <dt>{r.k}</dt>
                      <dd
                        className={r.negative && shown ? "negative" : undefined}
                      >
                        {r.v}
                      </dd>
                    </div>
                  ))}
                </dl>
                {state.signedOut ? (
                  <button
                    type="button"
                    className={`btn btn-primary btn-split ${styles.cta}`}
                    onClick={() => services.auth.prompt("trade")}
                  >
                    <span>Log in to trade</span>
                    <ArrowRight size={16} />
                  </button>
                ) : phone ? (
                  <button
                    type="button"
                    className={`btn btn-primary btn-split ${styles.cta}`}
                    disabled={invalid || quoting}
                    onClick={review}
                  >
                    <span>{quoting ? "Getting a price…" : "Review order"}</span>
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <SwipeToReview
                    key={`${outcome}`}
                    disabled={invalid || quoting}
                    blockedLabel={quoting ? "Getting a price…" : "Fix amount to continue"}
                    onComplete={review}
                  />
                )}
              </div>
            )}

            {step === "preview" && quote && (
              <div className={styles.step} aria-live="polite">
                <h3 ref={stepHeading} tabIndex={-1} className={styles.summary}>
                  Buy {quote.shares.toLocaleString()} {outcome} at{" "}
                  {centsText(quote.priceCents)}
                </h3>
                <dl className={`${styles.rows} ${styles.reviewRows}`}>
                  {rows.map((r) => (
                    <div key={r.k} data-strong={r.strong || undefined}>
                      <dt>{r.k}</dt>
                      <dd>{r.v}</dd>
                    </div>
                  ))}
                  {outcomes.map((r) => (
                    <div key={r.k} data-strong>
                      <dt>{r.k}</dt>
                      <dd className={r.negative ? "negative" : undefined}>
                        {r.v}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className={`btn btn-primary btn-split ${styles.place}`}
                  onClick={place}
                >
                  <span>Place order</span>
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary ${styles.edit}`}
                  onClick={() => setStep("edit")}
                >
                  Edit
                </button>
              </div>
            )}

            {step === "submitting" && (
              <div className={styles.step} role="status">
                <h3 ref={stepHeading} tabIndex={-1} className={styles.sending}>
                  <Spinner size={18} className={styles.spinner} />
                  Placing your paper order…
                </h3>
                <div className={styles.progress} aria-hidden="true">
                  <span />
                </div>
                <p className={styles.pending}>Filling against {venue}’s live order book</p>
              </div>
            )}

            {step === "done" && placed && (
              <div className={styles.step} role="status">
                <div className={styles.filled} data-status={placed.status}>
                  <span aria-hidden="true">
                    {placed.filledShares ? <Check size={16} /> : <CircleX size={16} />}
                  </span>
                  <h3 ref={stepHeading} tabIndex={-1}>
                    {outcomeTitle(placed)}
                  </h3>
                </div>
                <p className={styles.doneText}>{outcomeText(placed, outcome)}</p>
                <Link
                  href="/portfolio"
                  className={`btn btn-primary btn-split ${styles.portfolio}`}
                >
                  <span>View in portfolio</span>
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href={`/post/${post.id}#replies`}
                  className={`btn btn-secondary ${styles.edit}`}
                >
                  <ChatCircle size={15} />
                  Join the discussion
                </Link>
              </div>
            )}
          </div>

          <p className={styles.footnote}>
            You’re placing your own trade. imo never copies trades
            automatically. Simulated funds.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
