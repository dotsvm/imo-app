"use client";
/* 16 · Settings. 16.1: every section on one page beside a nav that
   follows your place. 16.2: on a phone, a grouped list; each row opens
   its section. */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  FlaskConical,
  KeyRound,
  Link2,
  Palette,
  Shield,
  UserRound,
} from "@/components/icons";
import { useDemo, useLoadingView, useSeason } from "@/services/provider";
import { Bone, Loading } from "@/components/skeleton";
import { usd } from "@imo/domain/money";
import type { Category } from "@imo/domain/types";
import { portfolioTotals } from "@imo/domain/engine";
import { SignInWall, Modal } from "@/components/ui";
import { useMediaQuery } from "@/components/use-media-query";
import { AvatarPicker } from "./avatar-picker";
import styles from "./settings.module.css";
import {
  rolloutTag,
  venueDisplay,
  venueEntry,
  venueIds,
  venueList,
  venueName,
} from "@/data/venues";

/** What people follow; they tune suggested traders and the feed. */
const CATEGORIES: Category[] = ["Economics", "Politics", "Tech", "Science", "Climate", "Sports", "Crypto", "Culture"];

const sections = [
  { id: "profile", label: "Profile", Icon: UserRound },
  { id: "account", label: "Account", Icon: KeyRound },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "privacy", label: "Privacy", Icon: Shield },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "connected", label: "Connected accounts", Icon: Link2 },
  { id: "demo", label: "Paper account", Icon: FlaskConical },
] as const;
type SectionId = (typeof sections)[number]["id"];
const isSection = (id: string | null): id is SectionId =>
  sections.some((s) => s.id === id);

const themes = [
  { label: "Midnight", swatch: "#090d0b" },
  { label: "Dim", swatch: "#1c1f24" },
  { label: "System", swatch: "linear-gradient(90deg,#090d0b 50%,#252832 50%)" },
] as const;
const privacyToggles = [
  {
    key: "showPositionsOnPosts",
    label: "Show my positions on posts",
    description: "Required for predictions on markets you hold",
  },
  {
    key: "appearOnLeaderboard",
    label: "Appear on leaderboards",
    description: "Your P&L, ROI and accuracy are ranked publicly",
  },
  {
    key: "privateOpenPositions",
    label: "Private open positions",
    description:
      "Hide open positions on your profile; resolved results stay public",
  },
] as const;
/** A new season's balance (the deployment's), how often one may start,
    and when yours may. */
function useNewSeason() {
  const { services } = useDemo();
  const season = useSeason();
  const resetCents = services.config()?.paper.startingBalanceCents ?? season.startCents;
  // The server leaves it out once a new season may start.
  const waitUntil = season.nextResetAt
    ? new Date(season.nextResetAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  return { ...season, resetCents, waitUntil };
}
const seasonRule = (s: ReturnType<typeof useNewSeason>) =>
  `Once every ${s.resetDays} days${s.waitUntil ? ` (yours: from ${s.waitUntil})` : ""}.`;

/** What every section needs: settings, a way to save, and a confirmation. */
function useSettings() {
  const { state, services } = useDemo();
  const [saved, setSaved] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const notify = (message: string) => {
    setSaved(message);
    window.setTimeout(() => setSaved(""), 4000);
  };
  const settings = state.settings;
  return {
    state,
    services,
    settings,
    saved,
    notify,
    patch: (value: Partial<typeof settings>, message: string) => {
      services.settings.update(value);
      notify(message);
    },
    resetOpen,
    setResetOpen,
    totals: portfolioTotals(state, services.markets.list()),
  };
}
type Model = ReturnType<typeof useSettings>;

export function Settings() {
  const { state } = useDemo();
  if (state.signedOut)
    return <SignInWall title="Settings are yours" description="Log in to edit your profile, privacy and notifications." />;
  return <SettingsPage />;
}

/** A field's label and its input, while your settings load. */
function FieldLoading({ w = 80 }: { w?: number }) {
  return (
    <span className={styles.field}>
      <Bone w={w} h={10} />
      <Bone w="100%" h={40} r={10} />
    </span>
  );
}

/** Your profile's shape — photo, illustrations, fields — while it loads. */
function ProfileLoading() {
  return (
    <>
      <div className={styles.avatarLoading}>
        <Bone circle={72} />
        <Bone w={124} h={36} r="pill" />
      </div>
      <Bone w={110} h={10} />
      <div className={styles.illustrationsLoading} aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <Bone key={i} circle={48} />
        ))}
      </div>
      <div className={styles.grid}>
        <FieldLoading w={84} />
        <FieldLoading w={50} />
      </div>
      <FieldLoading w={30} />
    </>
  );
}

function SettingsLoading({ phone }: { phone: boolean }) {
  if (phone)
    return (
      <Loading label="Loading your settings" className={styles.phone}>
        <header className={styles.phoneHead}>
          <Bone circle={36} />
          <h1>Settings</h1>
        </header>
        <div className={styles.phoneBody}>
          <ul className={styles.group}>
            {sections.map(({ id, label, Icon }) => (
              <li key={id} className={styles.groupRow}>
                <Icon size={18} />
                <span>{label}</span>
                <Bone w={56} h={10} style={{ marginLeft: "auto" }} />
              </li>
            ))}
          </ul>
        </div>
      </Loading>
    );
  return (
    <Loading label="Loading your settings" className={styles.page}>
      <nav className={styles.nav} aria-hidden="true">
        <h1>Settings</h1>
        <ul className={styles.navList} data-indicator="pill">
          {sections.map(({ id, label, Icon }) => (
            <li key={id}>
              <span className={styles.navLoading} data-first={id === "profile" || undefined}>
                <Icon size={16} />
                {label}
              </span>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.panel}>
        <section className={styles.section}>
          <h2>Profile</h2>
          <ProfileLoading />
        </section>
        <section className={styles.section}>
          <h2>Account</h2>
          <div className={styles.grid}>
            <FieldLoading w={120} />
            <FieldLoading w={60} />
          </div>
        </section>
      </div>
    </Loading>
  );
}

function SettingsPage() {
  const phone = useMediaQuery("(max-width: 600px)");
  const loading = useLoadingView();
  const m = useSettings();
  if (loading) return <SettingsLoading phone={phone} />;
  return (
    <>
      {phone ? <Phone m={m} /> : <Desktop m={m} />}
      <ResetDialog m={m} />
    </>
  );
}

function Saved({ m }: { m: Model }) {
  return (
    <p
      className={styles.saved}
      role="status"
      data-on={m.saved ? true : undefined}
    >
      {m.saved && (
        <>
          <Check size={15} />
          {m.saved}
        </>
      )}
    </p>
  );
}

/* --------------------------------------------------------- 16.1 desktop */
function Desktop({ m }: { m: Model }) {
  const params = useSearchParams();
  const [active, setActive] = useState<SectionId>("profile");
  // Arrive at a section named in the link: #privacy or ?section=privacy.
  useEffect(() => {
    const asked = window.location.hash.slice(1) || params.get("section");
    if (isSection(asked)) {
      document.getElementById(asked)?.scrollIntoView({ block: "start" });
      queueMicrotask(() => setActive(asked));
    }
  }, [params]);
  // The nav follows your place: the section crossing the top third.
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  const go = (id: SectionId) => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    document.getElementById(id)?.scrollIntoView({
      block: "start",
      behavior: smooth ? "smooth" : "auto",
    });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  };
  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Settings sections">
        <h1>Settings</h1>
        <ul className={styles.navList} data-indicator="pill">
          {sections.map(({ id, label, Icon }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(id);
                }}
              >
                <Icon size={16} />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.panel}>
        <Saved m={m} />
        <ProfileSection m={m} />
        <AccountSection m={m} />
        <AppearanceSection m={m} />
        <PrivacySection m={m} />
        <NotificationsSection m={m} />
        <ConnectedSection m={m} />
        <DemoSection m={m} />
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  children,
  bare = false,
}: {
  id: SectionId;
  title: string;
  children: ReactNode;
  /** On a phone the page itself carries the title. */
  bare?: boolean;
}) {
  return (
    <section
      id={id}
      className={styles.section}
      aria-labelledby={bare ? undefined : `${id}-title`}
      aria-label={bare ? title : undefined}
    >
      {!bare && <h2 id={`${id}-title`}>{title}</h2>}
      {children}
    </section>
  );
}

/** A field that saves when you leave it (or press Enter), not on every key;
    the server's answer — or its refusal — shows beside it. */
function DraftField({
  label,
  value,
  save,
  prefix = "",
  multiline = false,
  maxLength,
  type = "text",
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  save(next: string): Promise<void>;
  /** Shown before the value, like the @ of a handle. */
  prefix?: string;
  multiline?: boolean;
  maxLength?: number;
  type?: string;
  autoComplete?: string;
  hint?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Saved elsewhere (or refused and rolled back): start from the new value.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = async () => {
    const next = draft.trim();
    if (next === value) return;
    setError(null);
    try {
      await save(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
      setDraft(value);
    }
  };
  const common = {
    className: "input",
    value: `${prefix}${draft}`,
    maxLength,
    "aria-invalid": !!error || undefined,
    onChange: (e: { target: { value: string } }) =>
      setDraft(prefix ? e.target.value.replace(new RegExp(`^\\${prefix}+`), "") : e.target.value),
    onBlur: () => void commit(),
  };
  return (
    <label className={styles.field}>
      {label}
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={type}
          autoComplete={autoComplete}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {multiline && maxLength && (
        <span className={styles.count}>
          {draft.length}/{maxLength}
        </span>
      )}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : (
        hint
      )}
    </label>
  );
}

function ProfileSection({ m, bare }: { m: Model; bare?: boolean }) {
  const { settings, services, notify } = m;
  return (
    <Section id="profile" title="Profile" bare={bare}>
      <AvatarPicker onSaved={notify} />
      <div className={styles.grid}>
        <DraftField
          label="Display name"
          value={settings.displayName}
          maxLength={50}
          save={async (displayName) => {
            await services.settings.save({ displayName });
            notify("Display name saved.");
          }}
        />
        <DraftField
          label="Handle"
          prefix="@"
          value={settings.handle}
          maxLength={25}
          save={async (handle) => {
            await services.settings.save({ handle });
            notify("Handle saved.");
          }}
        />
      </div>
      <DraftField
        label="Bio"
        multiline
        maxLength={280}
        value={settings.bio}
        save={async (bio) => {
          await services.settings.save({ bio });
          notify("Bio saved.");
        }}
      />
      <div className={styles.interests} role="group" aria-label="Interests">
        <span>Interests</span>
        {CATEGORIES.map((c) => {
          const on = settings.interests.includes(c);
          return (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => {
                const interests = on ? settings.interests.filter((x) => x !== c) : [...settings.interests, c];
                void services.settings.save({ interests }).then(
                  () => notify(on ? `${c} removed from your interests.` : `${c} added to your interests.`),
                  () => undefined,
                );
              }}
            >
              {on && <Check size={12} />}
              {c}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

const METHODS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  x: "X",
  twitter: "X",
  email: "an emailed link",
  "web3:solana": "a Solana wallet",
  "web3:ethereum": "an Ethereum wallet",
  dev: "a local session",
};
const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

function AccountSection({ m, bare }: { m: Model; bare?: boolean }) {
  const { state, settings, services, notify } = m;
  const { account } = state;
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState("");
  return (
    <Section id="account" title="Account" bare={bare}>
      <div className={styles.signedIn}>
        <span>
          <strong>Signed in with {METHODS[account.method ?? ""] ?? "your account"}</strong>
          <span>
            {account.role === "admin" ? "Admin · " : ""}
            There’s no password to change: Google, your wallet or an emailed link is how you get in.
          </span>
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void services.auth.signOut().catch(() => setLeaving(false));
          }}
        >
          {leaving ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <div className={styles.grid}>
        <DraftField
          label="Email for notifications"
          type="email"
          autoComplete="email"
          value={settings.email}
          save={async (email) => {
            await services.settings.save({ email });
            notify(`Check ${email}: we sent a link to confirm it.`);
          }}
          hint={
            settings.email ? (
              <span className={styles.fieldHint}>
                {account.emailVerified ? (
                  <>
                    <CheckCircle size={12} /> Confirmed
                  </>
                ) : (
                  "Waiting for you to confirm it: check your inbox."
                )}
              </span>
            ) : (
              <span className={styles.fieldHint}>Add one to get alerts and the weekly digest by email.</span>
            )
          }
        />
        <DraftField
          label="Region"
          value={settings.region}
          maxLength={60}
          save={async (region) => {
            await services.settings.save({ region });
            notify("Region saved.");
          }}
        />
      </div>
      {account.wallets.length > 0 && (
        <div className={styles.rows}>
          {account.wallets.map((wallet) => (
            <div className={styles.toggleRow} key={`${wallet.chain}:${wallet.address}`}>
              <span>
                <strong>
                  {wallet.chain === "solana" ? "Solana" : "Ethereum"} wallet · {short(wallet.address)}
                </strong>
                <span>
                  {wallet.custody === "embedded"
                    ? "Created for you when you joined. Self-custodial: imo never holds its keys."
                    : "The wallet you signed in with."}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(wallet.address).then(() => {
                    setCopied(wallet.address);
                    window.setTimeout(() => setCopied(""), 2000);
                  });
                }}
              >
                {copied === wallet.address ? "Copied" : "Copy address"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function AppearanceSection({ m, bare }: { m: Model; bare?: boolean }) {
  const { settings, patch } = m;
  return (
    <Section id="appearance" title="Appearance" bare={bare}>
      <div className={styles.themes} role="group" aria-label="Theme">
        {themes.map((theme) => (
          <button
            key={theme.label}
            type="button"
            aria-pressed={settings.theme === theme.label}
            onClick={() =>
              patch({ theme: theme.label }, `${theme.label} theme saved.`)
            }
          >
            <span style={{ background: theme.swatch }} />
            <strong>{theme.label}</strong>
          </button>
        ))}
      </div>
      <p className={styles.help}>
        imo ships one dark palette for now; your choice is kept for when the
        others arrive.
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={settings.priceInCents}
          onChange={(e) =>
            patch(
              { priceInCents: e.target.checked },
              e.target.checked
                ? "Prices show in cents."
                : "Prices show as percentages.",
            )
          }
        />
        Show prices as cents (62¢) instead of percent (62%)
      </label>
    </Section>
  );
}

function Switch({
  on,
  label,
  onToggle,
  disabled = false,
  title,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={styles.toggle}
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      <span />
    </button>
  );
}

function PrivacySection({ m, bare }: { m: Model; bare?: boolean }) {
  const { settings, patch } = m;
  return (
    <Section id="privacy" title="Privacy" bare={bare}>
      <div className={styles.rows}>
        {privacyToggles.map((item) => (
          <div className={styles.toggleRow} key={item.key}>
            <span>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </span>
            <Switch
              on={settings[item.key]}
              label={item.label}
              onToggle={() =>
                patch(
                  { [item.key]: !settings[item.key] } as Partial<
                    typeof settings
                  >,
                  `${item.label} ${settings[item.key] ? "off" : "on"}.`,
                )
              }
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function NotificationsSection({ m, bare }: { m: Model; bare?: boolean }) {
  const { settings, services } = m;
  return (
    <Section id="notifications" title="Notifications" bare={bare}>
      <div className={styles.prefHead} aria-hidden="true">
        <span>Event</span>
        <span>In-app</span>
        <span>Email</span>
      </div>
      <div className={styles.rows}>
        {settings.notifications.map((pref) => (
          <div className={styles.prefRow} key={pref.id}>
            <span>
              <strong>{pref.label}</strong>
              <span>{pref.description}</span>
            </span>
            {(["app", "email"] as const).map((channel) => (
              <Switch
                key={channel}
                on={pref[channel]}
                label={`${pref.label} — ${channel === "app" ? "in-app" : "email"}`}
                disabled={pref.locked && channel === "app"}
                title={
                  pref.locked && channel === "app"
                    ? "Failure alerts stay on so an order never fails silently."
                    : undefined
                }
                onToggle={() =>
                  services.settings.toggleNotification(pref.id, channel)
                }
              />
            ))}
          </div>
        ))}
      </div>
      <Link href="/notifications" className={styles.textLink}>
        Price alerts and your inbox live in Notifications
      </Link>
    </Section>
  );
}

function ConnectedSection({ bare }: { m: Model; bare?: boolean }) {
  const { services } = useDemo();
  // The venues this deployment shows prices from.
  const shown = services.config()?.venues ?? venueIds;
  return (
    <Section id="connected" title="Connected accounts" bare={bare}>
      {shown.map((id) => {
        const tag = rolloutTag(id);
        return (
          <div key={id} className={styles.venue}>
            <span className={styles.venueMark}>{venueDisplay(id).mark}</span>
            <span>
              <strong>{venueName(id)}</strong>
              <span>{venueEntry(id).rollout.summary}</span>
            </span>
            <span className={`tag tag-${tag.tone}`}>{tag.label}</span>
            <button type="button" className="btn btn-secondary" disabled>
              Connect
            </button>
          </div>
        );
      })}
      <p className={styles.help}>
        Trading on {venueList("or", shown)} with your own account comes after the beta.
        Until then every order is paper, filled against the venue’s prices.
      </p>
    </Section>
  );
}

function DemoSection({ m, bare }: { m: Model; bare?: boolean }) {
  const season = useNewSeason();
  return (
    <Section id="demo" title="Paper account" bare={bare}>
      <div className={styles.danger}>
        <span>
          <strong>Start a new season</strong>
          <span>
            Your balance returns to {usd(season.resetCents)} and your record
            starts fresh. {seasonRule(season)} Your posts stay.
          </span>
        </span>
        <button
          type="button"
          className={`btn btn-secondary ${styles.resetButton}`}
          onClick={() => m.setResetOpen(true)}
        >
          New season…
        </button>
      </div>
    </Section>
  );
}

/** Reset asks you to type it, and says what it will undo. */
function ResetDialog({ m }: { m: Model }) {
  const { state, services, totals } = m;
  const season = useNewSeason();
  const [confirm, setConfirm] = useState("");
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const open = state.orders.filter((o) => o.status === "pending" || (o.status === "partial" && o.resting !== false)).length;
  const claimable = state.claimable.reduce((s, c) => s + c.payoutCents, 0);
  const allTime = totals.totalCents - season.startCents;
  return (
    <Modal
      open={m.resetOpen}
      onOpenChange={(o) => {
        m.setResetOpen(o);
        if (!o) setConfirm("");
      }}
      title="Start a new season?"
      description={`This closes ${state.positions.length} positions, cancels ${open} open ${open === 1 ? "order" : "orders"} and forfeits ${usd(claimable)} claimable. Your season P&L (${allTime >= 0 ? "+" : "−"}${usd(Math.abs(allTime))}) starts over, and you can do this once every ${season.resetDays} days.`}
    >
      {failed && (
        <p className="field-error" role="alert">
          {failed}
        </p>
      )}
      <label className={styles.field}>
        Type RESET to confirm
        <input
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="RESET"
          autoComplete="off"
        />
      </label>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => m.setResetOpen(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-destructive"
          disabled={busy || confirm.trim().toUpperCase() !== "RESET"}
          onClick={async () => {
            setBusy(true);
            setFailed("");
            try {
              await services.reset();
              m.setResetOpen(false);
              setConfirm("");
              m.notify(`New season started. Your balance is back to ${usd(season.resetCents)}.`);
            } catch (e) {
              setFailed((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Start new season
        </button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- 16.2 phone */
function Phone({ m }: { m: Model }) {
  const params = useSearchParams();
  const router = useRouter();
  const season = useNewSeason();
  const [hash, setHash] = useState("");
  useEffect(() => {
    queueMicrotask(() => setHash(window.location.hash.slice(1)));
  }, []);
  const asked = params.get("section") ?? hash;
  const open = isSection(asked) ? asked : null;
  const values: Partial<Record<SectionId, string>> = {
    profile: m.settings.displayName,
    appearance: m.settings.theme,
    notifications: `${m.settings.notifications.filter((p) => p.app).length} on`,
    connected: "Coming soon",
    demo: usd(m.totals.totalCents),
  };
  if (open) {
    const section = sections.find((s) => s.id === open)!;
    const Body = {
      profile: ProfileSection,
      account: AccountSection,
      appearance: AppearanceSection,
      privacy: PrivacySection,
      notifications: NotificationsSection,
      connected: ConnectedSection,
      demo: DemoSection,
    }[open];
    return (
      <div className={styles.phone}>
        <header className={styles.phoneHead}>
          <button
            type="button"
            className={`btn btn-icon ${styles.back}`}
            aria-label="All settings"
            onClick={() => {
              setHash("");
              router.replace("/settings", { scroll: false });
            }}
          >
            <CaretLeft size={20} />
          </button>
          <h1>{section.label}</h1>
        </header>
        <div className={styles.phoneBody}>
          <Saved m={m} />
          <Body m={m} bare />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.phone}>
      <header className={styles.phoneHead}>
        <Link
          href="/trader/you"
          className={`btn btn-icon ${styles.back}`}
          aria-label="Your profile"
        >
          <CaretLeft size={20} />
        </Link>
        <h1>Settings</h1>
      </header>
      <div className={styles.phoneBody}>
        <Saved m={m} />
        <nav aria-label="Settings sections">
          <ul className={styles.group}>
            {sections.map(({ id, label, Icon }) => (
              <li key={id}>
                <Link
                  href={`/settings?section=${id}`}
                  scroll={false}
                  className={styles.groupRow}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {values[id] && (
                    <span className={styles.groupValue}>{values[id]}</span>
                  )}
                  <CaretRight size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.phoneReset}>
          <b>Start a new season</b>
          <span>Your balance returns to {usd(season.resetCents)} and your record starts fresh. {seasonRule(season)}</span>
          <button
            type="button"
            className={`btn btn-secondary ${styles.resetButton}`}
            onClick={() => m.setResetOpen(true)}
          >
            Reset…
          </button>
        </div>
        <p className={styles.version}>
          <CheckCircle size={13} />
          imo beta · paper trading, simulated funds only
        </p>
      </div>
    </div>
  );
}
