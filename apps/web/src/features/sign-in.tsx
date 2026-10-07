"use client";
/* Signing in happens where you are: the feed (and every page) is open to
   read, and anything that needs an account opens this dialog — Google first,
   then a wallet or an emailed link (the demo trader where dev sessions are
   on). A new account picks its handle here; with the private beta's gate on,
   an invite code or the waitlist gets you in. */
import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import { GoogleMark } from "@/components/google-mark";
import { AvatarPicker } from "./avatar-picker";
import { useEffect, useState } from "react";
import {
  AppleLogo,
  ArrowRight,
  CircleAlert,
  CurrencyEth,
  MailCheck,
  SignOut,
  Ticket,
  Wallet,
  X,
  XLogo,
} from "@/components/icons";
import { Avatar, Button } from "@/components/ui";
import { useDemo } from "@/services/provider";
import { walletBrowserLink, type WalletChain } from "@/client/auth";
import { ApiRequestError } from "@/client/http";
import { YOU } from "@/client/normalize";
import styles from "./sign-in.module.css";

type Social = "google" | "apple" | "x";

const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";

/** What a failed return from Google or an emailed link means. */
export const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. Pick a way in below.",
  expired:
    "That sign-in link has expired, was already used, or was opened in another browser. Send a new one from this browser.",
  failed: "Sign-in didn't finish. Try again.",
};

const METHOD_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  x: "X",
  twitter: "X",
  email: "Email link",
  "web3:solana": "Solana wallet",
  "web3:ethereum": "Ethereum wallet",
  dev: "Local session",
};
export const methodLabel = (method: string | null) => METHOD_LABELS[method ?? ""] ?? "Signed in";

export const shortAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

/** Google's own mark, as its sign-in guidelines ask: full colour, on white. */

function Problem({ text, children }: { text: string | null; children?: React.ReactNode }) {
  if (!text) return <span className="sr-only" role="status" />;
  return (
    <p className={styles.error} role="alert">
      <CircleAlert size={14} />
      <span>
        {text} {children}
      </span>
    </p>
  );
}

/** Why the dialog opened, in a line. */
const REASONS: Record<string, string> = {
  trade: "Log in to trade with your paper balance.",
  post: "Log in to share your take.",
};

/** Where Google and emailed links bring you back: this page, as it was. */
const here = () => {
  const url = new URL(window.location.href);
  for (const param of ["login", "signin", "signedin"]) url.searchParams.delete(param);
  return `${url.pathname}${url.search}`;
};

export function SignInDialog() {
  const { state, services, ready } = useDemo();
  const prompt = state.authPrompt;
  const gated = state.signedIn && state.access.gated && !state.access.granted;
  const fresh = state.signedIn && !state.settings.onboarded;
  // Signed out: when something asked. Let in but not past the gate: when
  // asked, or just after signing up. A new account: once, for its handle.
  const step = !state.signedIn ? (prompt ? "signin" : null) : gated ? (prompt || fresh ? "gate" : null) : fresh ? "welcome" : null;
  const close = () => {
    // Closing the welcome keeps the handle they were given.
    if (step === "welcome") services.settings.update({ onboarded: true });
    services.auth.dismiss();
  };
  return (
    <Dialog.Root open={ready && step !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal modal-sheet ${styles.dialog}`}>
          <Dialog.Close className={`btn btn-icon ${styles.close}`} aria-label="Close">
            <X size={18} />
          </Dialog.Close>
          {step === "signin" && (
            <SignIn
              reason={prompt?.reason ? (REASONS[prompt.reason] ?? null) : null}
              initialProblem={prompt?.problem ? (SIGN_IN_PROBLEMS[prompt.problem] ?? null) : null}
            />
          )}
          {step === "gate" && <BetaGate onGranted={() => services.auth.dismiss()} />}
          {/* Keyed by who's signed in, so the handle field starts from theirs. */}
          {step === "welcome" && <SignedIn key={state.settings.handle} onContinue={() => services.auth.dismiss()} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SignIn({ reason, initialProblem }: { reason: string | null; initialProblem: string | null }) {
  const { services } = useDemo();
  const methods = services.auth.methods();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | Social | WalletChain | "email" | "demo">(null);
  const [problem, setProblem] = useState<string | null>(initialProblem);
  const [noWallet, setNoWallet] = useState<WalletChain | null>(null);
  const [sent, setSent] = useState("");
  const emailError = email.trim() && !isEmail(email);
  const run = async (which: NonNullable<typeof busy>, action: () => Promise<unknown>) => {
    setBusy(which);
    setProblem(null);
    setNoWallet(null);
    try {
      await action();
    } catch (error) {
      setProblem(message(error));
      if (error instanceof ApiRequestError && error.code === "no_wallet") setNoWallet(which as WalletChain);
    } finally {
      setBusy(null);
    }
  };
  // Back from Google (Apple, X) with the browser's back button: the page is
  // restored as it was left, mid-"Opening…".
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setBusy(null);
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  const social = async (provider: Social) => {
    setBusy(provider);
    setProblem(null);
    try {
      // Resolves as the browser leaves for the provider; the button stays busy.
      await services.auth.oauth(provider, here());
    } catch (error) {
      setProblem(message(error));
      setBusy(null);
    }
  };
  const wallet = (chain: WalletChain) =>
    run(chain, () => services.auth.wallet(chain));
  const sendLink = () =>
    run("email", async () => {
      if ((await services.auth.email(email, here())) === "sent") setSent(email.trim());
    });
  const demo = () =>
    run("demo", () => services.auth.demo());
  const anyEmail = methods.email || methods.dev;

  return (
    <div className={styles.step}>
      <Image src="/brand/wordmark.png" alt="" width={62} height={30} className={styles.brandMark} />
      <Dialog.Title asChild>
        <h2>Log in or sign up</h2>
      </Dialog.Title>
      <Dialog.Description asChild>
        <p>
          {reason ??
            (methods.google || methods.apple || methods.x || methods.wallet || methods.email
              ? "Keep your trades, follows and rooms. New to imo? The same buttons create your account."
              : "This deployment runs without a sign-in provider: explore as the demo trader, or start a fresh paper account under any email address.")}
        </p>
      </Dialog.Description>
      {methods.google && (
        <Button variant="primary" className={styles.cta} disabled={!!busy} onClick={() => void social("google")}>
          <span className={styles.method}>
            <GoogleMark />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </span>
          <ArrowRight size={16} />
        </Button>
      )}
      {(methods.apple || methods.x) && (
        <div className={styles.wallets}>
          {methods.apple && (
            <Button variant="secondary" disabled={!!busy} onClick={() => void social("apple")}>
              <AppleLogo size={17} />
              {busy === "apple" ? "Opening Apple…" : "Continue with Apple"}
            </Button>
          )}
          {methods.x && (
            <Button variant="secondary" disabled={!!busy} onClick={() => void social("x")}>
              <XLogo size={15} />
              {busy === "x" ? "Opening X…" : "Continue with X"}
            </Button>
          )}
        </div>
      )}
      {methods.wallet && (
        <div className={styles.wallets}>
          <Button variant="secondary" disabled={!!busy} onClick={() => wallet("solana")}>
            <Wallet size={16} />
            {busy === "solana" ? "Check your wallet…" : "Solana wallet"}
          </Button>
          <Button variant="secondary" disabled={!!busy} onClick={() => wallet("ethereum")}>
            <CurrencyEth size={16} />
            {busy === "ethereum" ? "Check your wallet…" : "Ethereum wallet"}
          </Button>
        </div>
      )}
      {anyEmail && (
        <>
          {(methods.google || methods.apple || methods.x || methods.wallet) && (
            <div className={styles.or}>
              <span>or with email</span>
            </div>
          )}
          <form
            className={styles.emailForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (isEmail(email) && !busy) void sendLink();
            }}
          >
            <label className={styles.field}>
              Email
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSent("");
                }}
                aria-invalid={!!emailError}
                aria-describedby="email-error"
                placeholder="you@example.com"
              />
            </label>
            {emailError ? (
              <p className={styles.error} id="email-error" role="alert">
                <CircleAlert size={14} />
                Enter a full email address, like name@example.com.
              </p>
            ) : (
              <span id="email-error" className="sr-only" />
            )}
            <Button
              type="submit"
              variant={methods.google ? "secondary" : "primary"}
              className={styles.cta}
              disabled={!isEmail(email) || !!busy}
            >
              {busy === "email" ? "Sending…" : methods.email ? "Send magic link" : "Start with this email"}
              <ArrowRight size={16} />
            </Button>
          </form>
          {sent && (
            <p className={styles.sent} role="status">
              <MailCheck size={16} />
              <span>
                Check {sent}: the link signs you in on this browser and expires in an hour. Nothing there? Look in spam,
                or send it again.
              </span>
            </p>
          )}
        </>
      )}
      <Problem text={problem}>
        {noWallet && (
          <a href={walletBrowserLink(noWallet)} className={styles.inlineLink}>
            Open in {noWallet === "solana" ? "Phantom" : "MetaMask"}
          </a>
        )}
      </Problem>
      {methods.dev && (
        <Button variant="ghost" className={styles.demo} disabled={!!busy} onClick={demo}>
          {busy === "demo" ? "Signing in…" : "Continue as the demo trader"}
        </Button>
      )}
      <span className={styles.legal}>
        By continuing you agree to the Terms and confirm you’re 18 or older. imo is paper trading: no deposits, and no
        real money moves.
      </span>
    </div>
  );
}

function BetaGate({ onGranted }: { onGranted(): void }) {
  const { state, services } = useDemo();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "redeem" | "out">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (which: NonNullable<typeof busy>, action: () => Promise<unknown>) => {
    setBusy(which);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(
        error instanceof ApiRequestError && error.status === 404 && which === "redeem"
          ? "That code doesn’t exist. Check it against your invite."
          : message(error),
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.step}>
      <Dialog.Title asChild>
        <h2>imo is invite-only for now</h2>
      </Dialog.Title>
      <Dialog.Description asChild>
        <p>
          You’re signed in{state.settings.email ? ` as ${state.settings.email}` : ""}. Read along as much as you like;
          to take part, enter an invite code, or claim your username on the waitlist and we’ll email you when
          there’s room.
        </p>
      </Dialog.Description>
      <form
        className={styles.emailForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 8 && !busy)
            void run("redeem", async () => {
              await services.auth.redeem(code);
              onGranted();
            });
        }}
      >
        <label className={styles.field}>
          Invite code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
          />
        </label>
        <Button type="submit" variant="primary" className={styles.cta} disabled={code.trim().length < 8 || !!busy}>
          <span className={styles.method}>
            <Ticket size={16} />
            {busy === "redeem" ? "Checking…" : "Redeem invite"}
          </span>
          <ArrowRight size={16} />
        </Button>
      </form>
      <div className={styles.or}>
        <span>no code yet?</span>
      </div>
      {services.config()?.waitlistUrl && (
        <a className={`btn btn-secondary ${styles.cta}`} href={services.config()!.waitlistUrl!}>
          Claim your username on the waitlist
          <ArrowRight size={16} />
        </a>
      )}
      <Problem text={problem} />
      <Button
        variant="ghost"
        className={styles.demo}
        disabled={!!busy}
        onClick={() => void run("out", () => services.auth.signOut())}
      >
        <SignOut size={14} />
        Use another account
      </Button>
    </div>
  );
}

function SignedIn({ onContinue }: { onContinue(): void }) {
  const { state, services } = useDemo();
  const me = services.profiles.get(YOU);
  const [handle, setHandle] = useState(state.settings.handle);
  const [busy, setBusy] = useState<null | "save" | "out">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const wallet = state.account.wallets.find((w) => w.isPrimary) ?? state.account.wallets[0];
  const clean = handle.replace(/^@+/, "").trim();
  const save = async () => {
    setBusy("save");
    setProblem(null);
    try {
      await services.settings.save({ ...(clean && clean !== state.settings.handle && { handle: clean }), onboarded: true });
      onContinue();
    } catch (error) {
      setProblem(message(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.step}>
      <Dialog.Title asChild>
        <h2>Welcome to imo</h2>
      </Dialog.Title>
      <Dialog.Description className="sr-only">Check who you’re signed in as, and pick your avatar and handle.</Dialog.Description>
      <div className={styles.who}>
        {me && <Avatar trader={me} />}
        <span>
          <b>{state.settings.displayName}</b>
          <span>
            {state.settings.email || (wallet ? shortAddress(wallet.address) : "")}
            {state.settings.email || wallet ? " · " : ""}
            {methodLabel(state.account.method)}
          </span>
        </span>
      </div>
      <AvatarPicker compact />
      {wallet?.custody === "embedded" && (
        <p className={styles.sent}>
          <Wallet size={16} />
          <span>
            Your {wallet.chain === "solana" ? "Solana" : "Ethereum"} wallet {shortAddress(wallet.address)} is ready. It’s
            yours alone; imo never holds its keys.
          </span>
        </p>
      )}
      <label className={styles.field}>
        Handle
        <input
          value={`@${handle.replace(/^@+/, "")}`}
          onChange={(e) => setHandle(e.target.value)}
          maxLength={25}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <Problem text={problem} />
      <Button variant="primary" className={styles.cta} disabled={!clean || !!busy} onClick={() => void save()}>
        {busy === "save" ? "Saving…" : "Continue"}
        <ArrowRight size={16} />
      </Button>
      <Button
        variant="ghost"
        className={styles.demo}
        disabled={!!busy}
        onClick={() => {
          setBusy("out");
          void services.auth.signOut().catch((error: unknown) => {
            setProblem(message(error));
            setBusy(null);
          });
        }}
      >
        <SignOut size={14} />
        Not you? Sign out
      </Button>
    </div>
  );
}
