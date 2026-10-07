"use client";
/**
 * The waitlist, as a founding pass (design/02-Waitlist-Pass): pick a username
 * and it prints on the pass as you type (checked as you go), choose the
 * pass's edition, and hold it by signing in right here — X, Google or an
 * emailed link. Claiming shows its steps as they happen. Once the pass is
 * yours, your link moves you up the line: once for posting it, and again for
 * every friend who claims through it. Every number is the line's own.
 */
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ApiRequestError } from "@web/client/http";
import { devSubject } from "@web/client/auth";
import { REFERRAL_BOOST, SHARE_BOOST } from "@imo/core/waitlist";
import {
  ArrowRight,
  Check,
  CheckCircle,
  CircleX,
  Link2,
  Lock,
  MailCheck,
  PaperPlaneTilt,
  SignOut,
  WarningCircle,
  XLogo,
} from "@web/components/icons";
import { GoogleMark } from "@web/components/google-mark";
import {
  checkHandle,
  claimHandle,
  countOpen,
  devSignIn,
  openWaitlist,
  sendSignInLink,
  shareWaitlist,
  signInUrl,
  signOutHere,
  waitlistCounts,
  type WaitlistConfig,
  type WaitlistCounts,
  type WaitlistStatus,
} from "./claims";
import { EDITIONS, EDITION_KEYS, FOUNDING_PASSES, isEdition, type Edition } from "./editions";
import { Pass } from "./pass";
import { ShareComposer } from "./share";
import styles from "./waitlist.module.css";

const HANDLE = /^[a-z0-9_]{2,24}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** The handle you were claiming, kept across a provider's round trip. */
const PENDING = "imo.pendingHandle";
/** The edition you picked: yours on this device until you claim. */
const EDITION_KEY = "imo.passEdition";
/** Whose link brought you here, until you claim. */
const REF_KEY = "imo.ref";
/** The links this browser has opened: each is counted once. */
const OPENED_KEY = "imo.opened";

type Phase = "pick" | "email" | "sent" | "claiming" | "claimed";
type Availability = "idle" | "checking" | "available" | "yours" | "taken" | "reserved" | "invalid" | "error";
type Provider = "x" | "google" | "email";
/** How you signed in: the claim's first step names it. */
type Via = Provider | "account";
const isProvider = (value: string | null): value is Provider =>
  value === "x" || value === "google" || value === "email";

const stored = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null, session = false) => {
  try {
    const where = session ? sessionStorage : localStorage;
    if (value) where.setItem(key, value);
    else where.removeItem(key);
  } catch {
    // Private windows may refuse storage; the link carries the handle too.
  }
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A step that's over at once still shows its check for a beat. */
const BEAT = 450;
/** "@pawan_tr…": short enough for the headline. */
const headline = (h: string) => (h.length > 9 ? `${h.slice(0, 8)}…` : h);
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the field says about a handle, and in which colour. */
const HINTS: Record<Availability, { text: (h: string) => string; tone: "muted" | "good" | "bad" | "gold" }> = {
  idle: { text: () => "2–24 letters, numbers or underscores", tone: "muted" },
  checking: { text: (h) => `Checking @${h}…`, tone: "muted" },
  available: { text: (h) => `@${h} is available`, tone: "good" },
  yours: { text: (h) => `@${h} is already yours`, tone: "good" },
  taken: { text: (h) => `@${h} is taken`, tone: "bad" },
  reserved: { text: (h) => `@${h} is reserved`, tone: "gold" },
  invalid: { text: () => "Use 2–24 letters, numbers or underscores", tone: "bad" },
  error: { text: () => "Couldn’t check just now — keep typing", tone: "bad" },
};
function StatusIcon({ state }: { state: Availability }) {
  if (state === "checking") return <span className={styles.spinner} />;
  if (state === "available" || state === "yours") return <CheckCircle size={18} />;
  if (state === "taken") return <CircleX size={18} />;
  if (state === "reserved") return <Lock size={17} />;
  if (state === "invalid" || state === "error") return <WarningCircle size={18} />;
  return null;
}

const PROVIDER_LABEL: Record<Provider, string> = { x: "X", google: "Google", email: "email" };

/**
 * `referrer`: the holder whose link this is (/i/[handle]), checked by the
 * server. The waitlist stands on its own for now: nothing here links to the
 * app itself.
 */
export function Waitlist({ referrer = null }: { referrer?: string | null }) {
  const params = useSearchParams();
  // A claim to finish: back from X, Google or your emailed link.
  const [resume] = useState(() => ({
    handle: params.get("claim"),
    via: params.get("via"),
    edition: params.get("edition"),
    failed: params.has("signin"),
    // Supabase sends people to its Site URL with ?code= when the address it
    // was asked to return to isn't on its allowed list.
    code: params.get("code"),
  }));
  // The form is there from the first paint: nothing on it waits for the
  // server. (Coming back from signing in, the claim's steps show instead.)
  const [phase, setPhase] = useState<Phase>(
    (resume.handle || resume.code) && !resume.failed ? "claiming" : "pick",
  );
  const [via, setVia] = useState<Via>(isProvider(resume.via) ? resume.via : "account");
  const [step, setStep] = useState(0);
  const [printed, setPrinted] = useState<number | null>(null);
  const [cfg, setCfg] = useState<WaitlistConfig | null>(null);
  const [status, setStatus] = useState<WaitlistStatus | null>(null);
  const [counts, setCounts] = useState<WaitlistCounts | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [handle, setHandle] = useState(resume.handle ?? "");
  const [check, setCheck] = useState<Availability>("idle");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(
    resume.failed ? "Signing in didn’t finish. Try again." : null,
  );
  const [edition, setEdition] = useState<Edition>(isEdition(resume.edition) ? resume.edition : "classic");
  const [providerAt, setProviderAt] = useState(0);
  const [sharing, setSharing] = useState(false);
  /** Each opening of the composer starts from a fresh draft. */
  const [draft, setDraft] = useState(0);
  const [posting, setPosting] = useState(false);
  const [shareProblem, setShareProblem] = useState<string | null>(null);
  /** Spots your post just moved you up; null until you post. */
  const [moved, setMoved] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  /** The emailed link can be sent again from this moment (a minute apart). */
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(0);
  /** Moves between states glide only once the first state has drawn. */
  const [settled, setSettled] = useState(false);
  const pass = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const editionRef = useRef(edition);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The edition you picked last time, once the page is in the browser.
  useEffect(() => {
    const saved = stored(EDITION_KEY);
    if (!resume.edition && isEdition(saved))
      queueMicrotask(() => {
        editionRef.current = saved;
        setEdition(saved);
      });
    return () => clearTimeout(copiedTimer.current);
  }, [resume.edition]);
  // Typed before the page woke up: hydration leaves the text on screen, but
  // the next render would wipe it. Keep it.
  useEffect(() => {
    const early = field.current?.value;
    if (early)
      queueMicrotask(() => setHandle((now) => now || early.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24)));
  }, []);
  const pickEdition = (next: Edition) => {
    editionRef.current = next;
    setEdition(next);
    store(EDITION_KEY, next);
  };

  useEffect(() => {
    if (settled) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [phase, settled]);

  /** Hold the handle: the server sets it, puts you in line and numbers your
      pass; then the pass prints. */
  const claim = useCallback(async (wanted: string) => {
    setPhase("claiming");
    setHandle(wanted);
    setStep(1);
    setPrinted(null);
    setProblem(null);
    const started = Date.now();
    try {
      const ref = stored(REF_KEY);
      const next = await claimHandle(wanted, { edition: editionRef.current, ...(ref ? { ref } : {}) });
      await wait(BEAT - (Date.now() - started));
      store(PENDING, null, true);
      store(REF_KEY, null);
      setPrinted(next.pass);
      setStep(2);
      await wait(calm() ? 250 : 1100);
      setStatus(next);
      setSignedIn(true);
      setCounts({ waiting: next.waiting, joined: next.joined, passesLeft: next.passesLeft });
      setStep(3);
      setMoved(null);
      setPhase("claimed");
      if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    } catch (error) {
      store(PENDING, null, true);
      setProblem(
        error instanceof ApiRequestError && error.code === "handle_taken"
          ? `@${wanted} was taken a moment ago. Try another.`
          : message(error),
      );
      setPhase("pick");
    }
  }, []);

  // Where you stand and the line's counts — then finish a claim you started
  // before signing in.
  useEffect(() => {
    // Landed here from Supabase's fallback: finish signing in the usual way.
    // The handle being claimed waits in this tab (PENDING), so the claim goes
    // on once the session is set.
    if (resume.code) {
      window.location.replace(`/api/v1/auth/callback?code=${encodeURIComponent(resume.code)}&next=%2F`);
      return;
    }
    let live = true;
    void waitlistCounts().then((c) => live && c && setCounts(c));
    void (async () => {
      const started = Date.now();
      const opened = await openWaitlist();
      if (!live) return;
      setCfg(opened.config);
      const me = opened.status;
      // Someone's link: remembered for your claim, and counted once here.
      if (referrer && me?.handle.toLowerCase() !== referrer.toLowerCase()) {
        if (!me?.onList) store(REF_KEY, referrer);
        const seen = (stored(OPENED_KEY) ?? "").split(",").filter(Boolean);
        if (!seen.includes(referrer)) {
          store(OPENED_KEY, [...seen, referrer].slice(-50).join(","));
          void countOpen(referrer);
        }
      }
      const wanted = resume.failed ? null : (resume.handle ?? stored(PENDING));
      if (!me && opened.failed && wanted) {
        // Where you stand couldn't be read, but a claim is waiting: try it.
        // If you're not signed in after all, the claim says so.
        void claim(wanted);
        return;
      }
      if (!me) {
        if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
        // What you've typed in the meantime stays.
        setHandle((now) => now || wanted || resume.handle || "");
        if (opened.failed) setProblem("Couldn’t load your pass just now. Refresh to try again.");
        setPhase((now) => (now === "claiming" ? "pick" : now));
        return;
      }
      setSignedIn(true);
      setStatus(me);
      if (wanted) {
        // Signed in: the first step is done.
        setPhase("claiming");
        await wait(BEAT - (Date.now() - started));
        if (live) void claim(wanted);
        return;
      }
      if (me.onList) return setPhase("claimed");
      setHandle((now) => now || me.handle.toLowerCase());
      setPhase((now) => (now === "claiming" ? "pick" : now));
    })();
    return () => {
      live = false;
    };
  }, [resume, claim, referrer]);

  // Is it free? Checked as you type, a moment after you stop.
  const shape = !handle ? "idle" : HANDLE.test(handle) ? null : "invalid";
  useEffect(() => {
    if (shape) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCheck("checking");
      checkHandle(handle, controller.signal)
        .then((answer) =>
          setCheck(answer.yours ? "yours" : answer.available ? "available" : (answer.reason ?? "taken")),
        )
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setCheck(error instanceof ApiRequestError && error.status === 429 ? "idle" : "error");
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle, shape]);
  const state: Availability = shape ?? check;
  const free = state === "available" || state === "yours";

  // The ways in this deployment offers, X first as the design has it.
  const providers = (["x", "google", "email"] as const).filter(
    (p) => cfg?.ways.includes(p) || (p === "email" && cfg?.dev),
  );
  const provider: Provider | undefined = providers[providerAt % Math.max(1, providers.length)];
  const nextProvider = providers.length > 1 ? providers[(providerAt + 1) % providers.length] : undefined;
  /** Where signing in brings you back to: here, to finish the claim. */
  const back = (how: Provider) =>
    `/?claim=${encodeURIComponent(handle)}&via=${how}&edition=${editionRef.current}`;

  /** Off to X or Google, by way of our server; back to finish the claim. */
  const oauth = (which: "x" | "google") => {
    setBusy(true);
    setProblem(null);
    store(PENDING, handle, true);
    window.location.assign(signInUrl(which, back(which)));
  };

  const sendLink = async () => {
    if (!cfg || !free || !EMAIL.test(email.trim())) return;
    setBusy(true);
    setProblem(null);
    store(PENDING, handle, true);
    try {
      if (cfg.ways.includes("email")) {
        await sendSignInLink(email.trim(), back("email"));
        setResendAt(Date.now() + 60_000);
        setClock(Date.now());
        setPhase("sent");
      } else if (cfg.dev) {
        // Local development and tests: the address signs in on the spot.
        setVia("email");
        setStep(0);
        setPhase("claiming");
        const started = Date.now();
        await devSignIn(devSubject(email), email.trim(), handle);
        setSignedIn(true);
        await wait(BEAT - (Date.now() - started));
        await claim(handle);
      } else throw new Error("Email sign-in isn’t set up here yet.");
    } catch (error) {
      setProblem(message(error));
      setPhase((now) => (now === "claiming" ? "email" : now));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "sent") return;
    const tick = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [phase]);
  const waitToResend = Math.max(0, Math.ceil((resendAt - clock) / 1_000));

  const go = () => {
    if (!free || busy) return;
    if (signedIn) {
      setVia("account");
      return void claim(handle);
    }
    if (provider === "email") return setPhase("email");
    if (provider) oauth(provider);
  };

  const signOut = async () => {
    setBusy(true);
    await signOutHere();
    store(PENDING, null, true);
    setSignedIn(false);
    setStatus(null);
    setHandle("");
    setMoved(null);
    setBusy(false);
    setPhase("pick");
  };

  /** Post your pass: X's composer opens with it, and you move up the line. */
  const post = (text: string) => {
    // Open X in the click itself, or the browser blocks the window.
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    const before = status?.position ?? null;
    setPosting(true);
    setShareProblem(null);
    shareWaitlist()
      .then((next) => {
        setStatus(next);
        setCounts({ waiting: next.waiting, joined: next.joined, passesLeft: next.passesLeft });
        const up = before && next.position ? before - next.position : 0;
        setMoved(up > 0 ? up : null);
        setSharing(false);
      })
      .catch((error: unknown) => setShareProblem(message(error)))
      .finally(() => setPosting(false));
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (an old browser, a refused permission): the link is on
      // screen to copy by hand.
    }
  };

  // The pass leans toward your pointer, and the light follows it.
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    const el = pass.current;
    if (!el || event.pointerType === "touch" || calm()) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    const max = box.width >= 1024 ? 40 : 34;
    el.style.transition = "transform .15s ease-out";
    el.style.transform = `rotateY(${x * max}deg) rotateX(${-y * max * 0.8}deg)`;
    el.style.setProperty("--gx", `${50 + x * 90}%`);
    el.style.setProperty("--gy", `${50 + y * 90}%`);
  };
  const settle = () => {
    const el = pass.current;
    if (!el) return;
    el.style.transition = "transform .6s cubic-bezier(.2,.7,.2,1)";
    el.style.transform = "";
  };

  const claimed = phase === "claimed" && status?.onList ? status : null;
  const picking = phase === "pick" || phase === "email" || phase === "sent";
  const shown = (claimed ? claimed.handle : handle) || "yourname";
  const ed: Edition = claimed && isEdition(claimed.edition) ? claimed.edition : edition;
  const E = EDITIONS[ed];
  const founding = claimed ? claimed.founding : (counts?.passesLeft ?? 1) > 0;
  const hint = HINTS[state];
  // Only drawn once the page is in the browser: the claimed state never
  // renders on the server.
  const link = claimed
    ? {
        url: `${window.location.origin}/i/${claimed.handle}`,
        shown: `${window.location.host}/i/${claimed.handle}`,
      }
    : null;

  const editions = () => (
    <div className={styles.editions} role="radiogroup" aria-label="Pass edition">
      {EDITION_KEYS.map((key) => (
        <label key={key} className={styles.swatch} title={EDITIONS[key].label}>
          <input
            type="radio"
            name="edition"
            value={key}
            checked={edition === key}
            onChange={() => pickEdition(key)}
            aria-label={`${EDITIONS[key].label} edition`}
          />
          <span style={{ background: EDITIONS[key].face }} />
        </label>
      ))}
    </div>
  );

  const ctaLabel = signedIn
    ? `Claim @${handle || "username"}`
    : !cfg
      ? "Claim"
      : provider === "x"
      ? "Claim with X"
      : provider === "google"
        ? "Claim with Google"
        : "Claim with email";

  // What the claim is doing, one line at a time.
  const steps: ReactNode[] = [
    via === "x" ? (
      <>
        Signing in with <XLogo size={13} aria-hidden="true" />
        <span className="sr-only">X</span>…
      </>
    ) : via === "google" ? (
      "Signing in with Google…"
    ) : via === "email" ? (
      "Confirming your email…"
    ) : (
      "Signed in"
    ),
    <>
      Holding <b>@{handle}</b>…
    </>,
    "Printing your pass…",
  ];
  const now = Math.min(step, steps.length - 1);

  return (
    <div
      className={styles.page}
      data-phase={phase}
      data-settled={settled || undefined}
      style={{ "--glow": E.glow } as CSSProperties}
      onPointerMove={tilt}
      onPointerLeave={settle}
    >
      <div className={styles.grain} aria-hidden="true" />

      <header className={styles.nav}>
        <Link href="/" aria-label="imo home" className={styles.brand}>
          <Image src="/brand/wordmark.png" alt="" width={58} height={28} priority />
        </Link>
        {counts && (
          <p className={styles.counts}>
            <span>
              <i className={styles.dot} aria-hidden="true" />
              {counts.waiting.toLocaleString("en-US")} waiting
            </span>
            <span className={styles.wide}>
              {counts.passesLeft.toLocaleString("en-US")} / {FOUNDING_PASSES.toLocaleString("en-US")} passes left
            </span>
          </p>
        )}
      </header>

      <main className={styles.main}>
        <h1
          className={styles.title}
          aria-label={claimed ? `@${claimed.handle} is yours, on the record.` : undefined}
        >
          <span className={styles.titleA}>
            {claimed ? (
              <>
                @{headline(claimed.handle)} <br className={styles.br} />
                is yours,
              </>
            ) : (
              <>
                Your <br className={styles.br} />
                name,
              </>
            )}
          </span>{" "}
          <em className={styles.titleB}>
            on the <br className={styles.br} />
            record.
          </em>
        </h1>

        <div className={styles.stage} data-done={claimed ? "" : undefined}>
          <span className={styles.shadow} aria-hidden="true" />
          <div className={styles.passScale}>
            <Pass
              ref={pass}
              handle={shown}
              number={claimed?.pass ?? printed}
              founding={founding}
              edition={ed}
              issuedAt={claimed?.issuedAt}
              printing={phase === "claiming"}
            />
          </div>

          {/* What imo feels like once you're in: people back your calls,
              fade them, follow you. An illustration, not a live feed. */}
          {picking && (
            <div className={styles.reactions} aria-hidden="true">
              <span className={styles.chip} data-slot="a">
                <Image src="/avatars/lorelei-14.svg" alt="" width={28} height={28} unoptimized />
                <span>
                  <b>Hazel</b> is backing <span className={styles.wide}>@{shown}</span>
                  <span className={styles.narrow}>you</span>
                </span>
                <span className={styles.wide} data-tone="good">
                  Yes
                </span>
              </span>
              <span className={styles.chip} data-slot="b">
                <Image src="/avatars/lorelei-01.svg" alt="" width={28} height={28} unoptimized />
                <span>
                  <b>Luis</b> is fading @{shown}
                </span>
                <span data-tone="bad">No</span>
              </span>
              <span className={styles.chip} data-slot="c">
                <Image src="/avatars/lorelei-08.svg" alt="" width={28} height={28} unoptimized />
                <span>
                  <b>Mira</b> followed you
                </span>
              </span>
              <span className={styles.chip} data-slot="d">
                <Image src="/avatars/lorelei-05.svg" alt="" width={28} height={28} unoptimized />
                <span>
                  <b>Rin</b>: early. respect.
                </span>
              </span>
            </div>
          )}
        </div>

        <section className={styles.dock} data-phase={phase} aria-live="polite">
          {referrer && picking && !status?.onList && (
            <p className={styles.via}>
              <i className={styles.dot} aria-hidden="true" />
              <b>@{referrer}</b> invited you
            </p>
          )}

          {phase === "pick" && (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
            >
              {editions()}
              <div className={styles.bar} data-state={state}>
                <label className="sr-only" htmlFor="pass-handle">
                  Choose your username
                </label>
                <span className={styles.at} aria-hidden="true">
                  @
                </span>
                <input
                  ref={field}
                  id="pass-handle"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24));
                    setProblem(null);
                  }}
                  placeholder="pick your username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={24}
                  autoFocus
                  aria-describedby="pass-hint"
                  aria-invalid={hint.tone === "bad" || undefined}
                />
                <span className={styles.status} data-tone={hint.tone} aria-hidden="true">
                  <StatusIcon state={state} />
                </span>
                <button
                  type="submit"
                  className={styles.cta}
                  data-kind={signedIn ? "claim" : provider}
                  disabled={!free || busy || (!signedIn && !provider)}
                  aria-label={ctaLabel}
                >
                  {signedIn ? (
                    <span className={styles.ctaText}>Claim @{handle || "username"}</span>
                  ) : !cfg ? (
                    <>
                      <span className={styles.ctaText}>Claim</span>
                      <ArrowRight size={16} />
                    </>
                  ) : provider === "x" ? (
                    <>
                      <span className={styles.ctaText}>Claim with</span>
                      <XLogo size={15} />
                    </>
                  ) : provider === "google" ? (
                    <>
                      <GoogleMark />
                      <span className={styles.ctaText}>Claim with Google</span>
                    </>
                  ) : (
                    <>
                      <MailCheck size={16} />
                      <span className={styles.ctaText}>Claim with email</span>
                    </>
                  )}
                </button>
              </div>
              <p className={styles.under}>
                <span id="pass-hint" data-tone={hint.tone}>
                  {hint.text(handle)}
                </span>
                <span className={styles.wide}>
                  <i aria-hidden="true">·</i>
                  {E.label} edition
                </span>
                {status?.onList ? (
                  <>
                    <i aria-hidden="true">·</i>
                    <button type="button" className={styles.link} onClick={() => setPhase("claimed")}>
                      Keep @{status.handle}
                    </button>
                  </>
                ) : signedIn ? (
                  <>
                    <i aria-hidden="true">·</i>
                    <button type="button" className={styles.link} onClick={() => void signOut()}>
                      Use another account
                    </button>
                  </>
                ) : (
                  nextProvider && (
                    <>
                      <i aria-hidden="true">·</i>
                      <button type="button" className={styles.link} onClick={() => setProviderAt((n) => n + 1)}>
                        or use{" "}
                        {nextProvider === "x" ? (
                          <>
                            <XLogo size={11} />
                            <span className="sr-only">X</span>
                          </>
                        ) : (
                          PROVIDER_LABEL[nextProvider]
                        )}
                      </button>
                    </>
                  )
                )}
              </p>
              {problem && (
                <p className={styles.problem} role="alert">
                  {problem}
                </p>
              )}
            </form>
          )}

          {phase === "email" && (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void sendLink();
              }}
            >
              <div className={styles.bar} data-state="email">
                <label className="sr-only" htmlFor="pass-email">
                  Your email
                </label>
                <span className={styles.at} aria-hidden="true">
                  <MailCheck size={17} />
                </span>
                <input
                  id="pass-email"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="submit"
                  className={styles.cta}
                  data-kind="email"
                  disabled={!EMAIL.test(email.trim()) || busy}
                  aria-label={busy ? "Sending" : "Email me a link"}
                >
                  <span className={styles.ctaText}>{busy ? "Sending…" : "Email me a link"}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
              <p className={styles.under}>
                <span>We’ll send a sign-in link for @{handle} — open it on this device.</span>
                <i aria-hidden="true">·</i>
                <button type="button" className={styles.link} onClick={() => setPhase("pick")}>
                  Back
                </button>
              </p>
              {problem && (
                <p className={styles.problem} role="alert">
                  {problem}
                </p>
              )}
            </form>
          )}

          {phase === "sent" && (
            <div className={styles.sent} role="status">
              <span className={styles.sentIcon} aria-hidden="true">
                <MailCheck size={18} />
              </span>
              <div className={styles.sentText}>
                <h2 className={styles.sentTitle}>Check your email</h2>
                <p className={styles.sentSub}>
                  We sent a sign-in link to <b>{email.trim()}</b>. Open it in this browser to hold <b>@{handle}</b>.
                </p>
                <div className={styles.sentActions}>
                  <button
                    type="button"
                    className={styles.sentAction}
                    disabled={busy || waitToResend > 0}
                    onClick={() => void sendLink()}
                  >
                    {busy ? "Sending…" : waitToResend > 0 ? `Resend in ${waitToResend}s` : "Resend link"}
                  </button>
                  <button type="button" className={styles.sentAction} onClick={() => setPhase("email")}>
                    Use a different email
                  </button>
                </div>
                {problem && (
                  <p className={styles.sentProblem} role="alert">
                    {problem}
                  </p>
                )}
              </div>
            </div>
          )}

          {phase === "claiming" && (
            <div className={styles.claiming} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <span key={now} className={styles.claimingText}>
                {steps[now]}
              </span>
              <span className="sr-only">
                , step {now + 1} of {steps.length}
              </span>
              <span className={styles.segments} aria-hidden="true">
                {steps.map((_, i) => (
                  <i key={i} data-state={step > i ? "done" : now === i ? "now" : undefined} />
                ))}
              </span>
            </div>
          )}

          {claimed && link && (
            <>
              <div className={styles.done} data-shared={moved ? "" : undefined}>
                <div className={styles.doneHead}>
                  <span className={styles.doneIcon} aria-hidden="true">
                    {moved ? <PaperPlaneTilt size={18} /> : <Check size={18} />}
                  </span>
                  <span className={styles.doneText}>
                    <h2 className={styles.doneTitle}>
                      {moved
                        ? `Shared. You moved up ${count(moved, "spot", "spots")}.`
                        : claimed.granted
                          ? "You’re in."
                          : "You’re on the list."}
                    </h2>
                    <span className={styles.doneSub}>
                      <span className={styles.wide}>
                        {moved
                          ? `Each friend who claims through your link moves you up ${REFERRAL_BOOST} more.`
                          : claimed.granted
                            ? `@${claimed.handle} is held · ${E.label} edition.`
                            : `@${claimed.handle} is held · ${E.label} edition · we’ll email you when your invite is ready.`}
                      </span>
                      <span className={styles.narrow}>
                        {moved ? "Shared to X" : `@${claimed.handle} · ${E.label}`}
                      </span>
                    </span>
                  </span>
                  {claimed.position !== null && (
                    <span className={styles.place}>
                      <span className={styles.placeTop}>
                        {moved && (
                          <span className={`${styles.up} ${styles.wide}`} aria-hidden="true">
                            ↑{moved}
                          </span>
                        )}
                        <b>#{claimed.position.toLocaleString("en-US")}</b>
                      </span>
                      <span className={styles.placeNote}>
                        <span className={styles.wide}>in line of {claimed.waiting.toLocaleString("en-US")}</span>
                        <span className={styles.narrow} data-tone={moved ? "good" : undefined}>
                          {moved ? `↑${count(moved, "spot", "spots")}` : "in line"}
                        </span>
                      </span>
                    </span>
                  )}
                </div>
                <hr className={styles.rule} />
                <p className={styles.refer}>
                  {claimed.granted
                    ? "Share your pass: friends who claim through your link join the line."
                    : !claimed.shared
                      ? `Skip the line: post your pass for +${SHARE_BOOST} spots, and get +${REFERRAL_BOOST} more for every friend who claims through your link.`
                      : claimed.opens > 0
                        ? `${count(claimed.opens, "person", "people")} opened your link so far${
                            claimed.referrals ? `, and ${count(claimed.referrals, "friend", "friends")} claimed through it` : ""
                          }. Keep it going.`
                        : "Your link is out there now. Opens and friends who claim through it show up here."}
                </p>
                <div className={styles.doneActions}>
                  <div className={styles.linkField}>
                    <Link2 size={15} className={styles.linkIcon} aria-hidden="true" />
                    <span className={styles.linkText}>{link.shown}</span>
                    <button
                      type="button"
                      className={styles.copy}
                      onClick={() => void copy(link.url)}
                      aria-label={copied ? "Link copied" : "Copy your link"}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.shareButton}
                    data-quiet={claimed.shared || undefined}
                    aria-label={claimed.shared ? "Post again on X" : "Share on X"}
                    onClick={() => {
                      setShareProblem(null);
                      setDraft((n) => n + 1);
                      setSharing(true);
                    }}
                  >
                    {claimed.shared ? "Post again" : "Share on"}
                    <XLogo size={15} aria-hidden="true" />
                  </button>
                </div>
                <p className={styles.referShort}>
                  {claimed.granted
                    ? "Friends who claim through your link join the line"
                    : !claimed.shared
                      ? `+${SHARE_BOOST} spots for posting, +${REFERRAL_BOOST} per friend who claims`
                      : claimed.opens > 0
                        ? `${count(claimed.opens, "person", "people")} opened your link so far`
                        : `+${REFERRAL_BOOST} spots per friend who claims through your link`}
                </p>
              </div>
              <p className={styles.under}>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    // A new name, on the same pass: start from its edition.
                    if (isEdition(claimed.edition)) pickEdition(claimed.edition);
                    setHandle(claimed.handle.toLowerCase());
                    setMoved(null);
                    setPhase("pick");
                  }}
                >
                  Change username
                </button>
                <i aria-hidden="true">·</i>
                <button type="button" className={styles.link} onClick={() => void signOut()}>
                  <SignOut size={12} /> Sign out
                </button>
              </p>
              <ShareComposer
                key={draft}
                open={sharing}
                onOpenChange={setSharing}
                status={claimed}
                link={link.shown}
                posting={posting}
                problem={shareProblem}
                onPost={post}
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
