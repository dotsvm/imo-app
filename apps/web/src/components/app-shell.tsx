"use client";
import Image from "next/image";
import Link from "next/link";
import { primaryVenue, venueIds, venueList, venueName } from "@/data/venues";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookmarkSimple,
  ChartPieSlice,
  Check,
  CircleHelp,
  Compass,
  Flask,
  GearSix,
  House,
  Info,
  MagnifyingGlass,
  Plus,
  RotateCcw,
  SignIn,
  Trophy,
  User,
  UsersThree,
  X,
  type AppIcon,
} from "./icons";
import { Composer } from "@/features/social";
import { SignInDialog } from "@/features/sign-in";
import { HomeLoading } from "@/features/home-loading";
import { DiscoverLoading } from "@/features/discover-loading";
import styles from "./terminal-shell.module.css";
import { Count, useIndicators, useTouchedToggles } from "./motion";
import { DemoProvider, useDemo } from "@/services/provider";
import { availableCash, portfolioTotals, unreadCount } from "@imo/domain/engine";
import { usd } from "@imo/domain/money";
import { TraderTicker } from "./ticker";
import { SEARCH_FIELD, SEARCH_RETURN } from "@/features/discover-model";
import { Avatar, Button, Empty, Modal, Skeleton } from "./ui";

type Destination = {
  label: string;
  href: string;
  Icon: AppIcon;
  /** Routes that light this destination, beyond its own href. */
  match: (path: string) => boolean;
};
const isHome = (path: string) =>
  path === "/" || path === "/feed" || path.startsWith("/post/");
/* The rail's destinations, in the design system's icon order. */
const rail: Destination[] = [
  { label: "Home", href: "/", Icon: House, match: isHome },
  {
    label: "Discover",
    href: "/discover",
    Icon: Compass,
    match: (p) => p.startsWith("/discover") || p.startsWith("/market/"),
  },
  {
    label: "Rooms",
    href: "/rooms",
    Icon: UsersThree,
    match: (p) => p.startsWith("/rooms"),
  },
  {
    label: "Watchlists",
    href: "/watchlist",
    Icon: BookmarkSimple,
    match: (p) => p.startsWith("/watchlist"),
  },
  {
    label: "Portfolio",
    href: "/portfolio",
    Icon: ChartPieSlice,
    match: (p) => p.startsWith("/portfolio") || p.startsWith("/position/"),
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    Icon: Trophy,
    match: (p) =>
      p.startsWith("/leaderboard") ||
      (p.startsWith("/trader/") && p !== "/trader/you"),
  },
  {
    label: "Notifications",
    href: "/notifications",
    Icon: Bell,
    match: (p) => p.startsWith("/notifications"),
  },
];
/* Bottom tabs on phones: the five places a thumb goes most. */
const tabs: Destination[] = [
  rail[0],
  // 10.2 · 14.2: on a phone, watchlists and the leaderboard live under
  // Discover.
  {
    ...rail[1],
    match: (p) =>
      rail[1].match(p) ||
      p.startsWith("/watchlist") ||
      p.startsWith("/leaderboard") ||
      (p.startsWith("/trader/") && p !== "/trader/you"),
  },
  rail[2],
  rail[4],
  {
    label: "Me",
    href: "/trader/you",
    Icon: User,
    match: (p) => p === "/trader/you" || p.startsWith("/settings"),
  },
];

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    params = useSearchParams();
  const { state, services, ready, storageMessage } = useDemo();
  // Toggles you touch can pop; selections everywhere slide.
  useTouchedToggles();
  useIndicators();
  // Everyone reads; signing in is a dialog over wherever you are.
  const signedOut = state.signedOut;
  const logIn = () => services.auth.prompt();
  // The design's sample world (a fixed snapshot), or live markets.
  const sample = !!services.config()?.dataSnapshot;
  // The demo deployment's workbench (page-state previews, the DEMO tag);
  // real deployments have none of it.
  const demo = services.config()?.profile === "demo";
  // The venues whose prices are on screen here.
  const shown = services.config()?.venues ?? [];
  const resetDays = services.config()?.paper.resetCooldownDays ?? 30;
  // Back from a provider with ?code= on a page: Supabase fell back to the
  // site's address (the callback isn't in its redirect list). Finish the
  // sign-in the usual way, returning here.
  const authCode = params.get("code");
  useEffect(() => {
    if (!authCode) return;
    const back = new URLSearchParams(params);
    back.delete("code");
    const query = back.toString();
    const finish = new URLSearchParams({ code: authCode, next: `${pathname}${query ? `?${query}` : ""}` });
    window.location.replace(`/api/v1/auth/callback?${finish}`);
  }, [authCode, params, pathname]);
  // ?login=1 (a link to sign in) or ?signin=… (back from Google or an
  // emailed link that didn't finish): open the dialog, once.
  const loginParam = params.get("login");
  const signinProblem = params.get("signin");
  useEffect(() => {
    if (!ready || (!loginParam && !signinProblem)) return;
    if (state.signedOut) services.auth.prompt(null, signinProblem);
    const next = new URLSearchParams(params);
    next.delete("login");
    next.delete("signin");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [ready, loginParam, signinProblem, state.signedOut, services, params, pathname, router]);
  const [composer, setComposer] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // The topbar's field, or search's own once search has the screen.
        const field = [
          searchInput.current,
          document.getElementById(SEARCH_FIELD),
        ].find(
          (el): el is HTMLInputElement =>
            el instanceof HTMLInputElement && el.offsetParent !== null,
        );
        field?.focus();
        field?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const [banner, setBanner] = useState(true);
  const [lab, setLab] = useState(false);
  const [about, setAbout] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(params.get("q") || "");
  const screen = (demo && params.get("state")) || "ready";
  // Home draws its own loading, empty and error states inside its panels.
  const home = pathname === "/" || pathname === "/feed";
  const discover = pathname === "/discover";
  // 03.1 · search takes over the topbar; the page draws its own query field.
  const searching = discover && params.has("q");
  const discoverList = discover && !searching && !params.get("category");
  // 04.2: a market is a drill-down; on phones it brings its own header
  // and trade bar in place of the shell's.
  const marketPage = pathname.startsWith("/market/");
  // 09.2: a room is a conversation — its own header, no tab bar. 08.2: the
  // directory titles itself.
  const roomPage = pathname.startsWith("/rooms/");
  // 12.2: a position brings its own header and Buy more / Sell bar.
  const positionPage = pathname.startsWith("/position/");
  // 10.1: two columns that scroll on their own. 10.2: its own title bar.
  const watchlist = pathname === "/watchlist";
  // 11.2: the portfolio opens on the account value, not the app header.
  const ownHeader =
    pathname === "/rooms" ||
    watchlist ||
    pathname === "/portfolio" ||
    pathname === "/notifications" ||
    // 13.2: a profile opens on the person, with settings a tap away.
    pathname.startsWith("/trader/") ||
    // 14.2: "Top traders" titles itself. 16.2: so does Settings.
    pathname === "/leaderboard" ||
    pathname.startsWith("/settings");
  // These screens preview their own states in place of the shell's.
  const ownStates = home || discover || marketPage || pathname === "/portfolio";
  // These draw their own skeleton, in their own layout, while data loads;
  // home and the discover list take theirs from the shell.
  const ownLoading =
    marketPage ||
    searching ||
    roomPage ||
    positionPage ||
    watchlist ||
    ["/portfolio", "/leaderboard", "/notifications", "/rooms"].includes(pathname) ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/trader/") ||
    pathname.startsWith("/post/");
  const shellLoading = (!ready && !ownLoading) || (screen === "loading" && !ownStates && !ownLoading);
  const unread = unreadCount(state);
  // Panelled screens manage their own gutters, so the shell drops its padding.
  const fullBleed =
    home ||
    [
      "/discover",
      "/portfolio",
      "/leaderboard",
      "/notifications",
      "/settings",
      "/watchlist",
    ].includes(pathname) ||
    pathname.startsWith("/post/") ||
    marketPage ||
    pathname.startsWith("/position/") ||
    pathname.startsWith("/trader/") ||
    pathname.startsWith("/rooms");
  // Panelled screens scroll inside their columns, not the page — their
  // skeletons too, so nothing moves when the content arrives.
  const previewShown = screen === "ready" || screen === "loading";
  const panelled =
    (ready || ownLoading) &&
    (home ||
      discoverList ||
      marketPage ||
      roomPage ||
      (previewShown &&
        (watchlist ||
          pathname === "/notifications" ||
          // 13.1: the record and the people column scroll on their own.
          pathname.startsWith("/trader/"))) ||
      (previewShown &&
        (pathname === "/portfolio" ||
          pathname.startsWith("/post/") ||
          positionPage)));
  const setScreen = (value: string) => {
    const p = new URLSearchParams(params);
    if (value === "ready") p.delete("state");
    else p.set("state", value);
    const query = p.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const totals = portfolioTotals(state, services.markets.list());
  return (
    <div
      className={styles.shell}
      data-banner={banner}
      data-searching={searching || undefined}
      data-detail={marketPage || roomPage || positionPage || undefined}
      data-own-header={ownHeader || undefined}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {banner && (
        <div
          className={styles.demoBanner}
          role="region"
          aria-label={sample ? "Demo mode" : "Paper trading"}
        >
          <span className={styles.demoMark} aria-hidden="true">
            <Flask size={12} />
          </span>
          <strong>{sample ? "Demo mode" : "Paper trading"}</strong>
          <span className={styles.demoDot} aria-hidden="true" />
          <span className={styles.demoCopy}>
            {sample
              ? `Simulated funds and fills — ${venueName(primaryVenue())} is the first supported venue.`
              : shown.length
                ? `Simulated funds, real prices from ${venueList("and", shown)}.`
                : "Simulated funds, real prices."}
          </span>
          <button className={styles.demoLink} onClick={() => setAbout(true)}>
            How it works
            <ArrowUpRight size={12} />
          </button>
          <span className={styles.demoSpacer} />
          <span className={styles.demoNote}>
            New season every {resetDays} days in Settings
          </span>
          <button
            className={`btn btn-icon ${styles.dismiss}`}
            onClick={() => setBanner(false)}
            aria-label="Dismiss banner"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.body}>
        <aside className={styles.rail} aria-label="imo">
          {/* The corner lines up with the header row; the logo sits in the header. */}
          <div className={styles.railBrand} aria-hidden="true" />
          <nav aria-label="Main navigation" className={styles.railNav} data-indicator="pill">
            {rail.map(({ label, href, Icon, match }) => {
              const badge = href === "/notifications" && unread > 0;
              return (
                <Link
                  key={href}
                  href={href}
                  className={styles.railItem}
                  data-tip={label}
                  aria-label={badge ? `${label}, ${unread} unread` : label}
                  aria-current={match(pathname) ? "page" : undefined}
                >
                  <Icon size={20} />
                  {badge && (
                    <span className={styles.badge} aria-hidden="true" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className={styles.railBottom}>
            <Link
              href="/settings"
              className={styles.railItem}
              data-tip="Settings"
              aria-label="Settings"
              aria-current={
                pathname.startsWith("/settings") ? "page" : undefined
              }
            >
              <GearSix size={20} />
            </Link>
            <button
              className={styles.railItem}
              data-tip={sample ? "About this demo" : "About imo"}
              aria-label={sample ? "About this demo" : "About imo"}
              onClick={() => setAbout(true)}
            >
              <CircleHelp size={20} />
            </button>
            {demo && (
              <button
                className={styles.railItem}
                data-tip="Demo controls"
                aria-label="Demo controls"
                onClick={() => setLab(true)}
              >
                <Flask size={20} />
              </button>
            )}
            {!ready ? null : signedOut ? (
              <button className={styles.railItem} data-tip="Log in" aria-label="Log in" onClick={logIn}>
                <SignIn size={20} />
              </button>
            ) : (
              <Link
                href="/trader/you"
                className={styles.railMe}
                data-tip="Your profile"
                aria-label="Your profile"
                aria-current={pathname === "/trader/you" ? "page" : undefined}
              >
                <Avatar trader={services.profiles.get("you")!} size={28} />
              </Link>
            )}
          </div>
        </aside>

        <div className={styles.frame}>
          {/* Topbar · a 56px search row over the 36px trader ticker. */}
          <header className={styles.topbar}>
            <div className={styles.topbarRow}>
              <Link href="/" className={styles.topbarBrand} aria-label="imo home">
                <Image src="/brand/wordmark.png" alt="" width={54} height={26} priority />
              </Link>
              <form
                className={styles.search}
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    // "Esc to close" returns to where the search began.
                    sessionStorage.setItem(
                      SEARCH_RETURN,
                      `${pathname}${window.location.search}`,
                    );
                  } catch {
                    // Without storage, closing search lands on Discover.
                  }
                  router.push(`/discover?q=${encodeURIComponent(search)}`);
                }}
              >
                <MagnifyingGlass size={16} aria-hidden="true" />
                <input
                  ref={searchInput}
                  type="search"
                  aria-label="Search markets"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search markets, traders, rooms"
                />
                <button
                  type="button"
                  className={styles.searchShortcut}
                  aria-label="Focus search (Command or Control K)"
                  onClick={() => searchInput.current?.focus()}
                >
                  <kbd>⌘</kbd>
                  <kbd>K</kbd>
                </button>
              </form>
              <div className={styles.headerActions} data-signed-out={signedOut || undefined}>
                {demo && (
                  <button
                    className={`tag tag-accent ${styles.demoTag}`}
                    onClick={() => setLab(true)}
                    aria-label="Demo mode — open demo controls"
                  >
                    DEMO
                  </button>
                )}
                {/* Until the session is known, no account chrome at all. */}
                {!ready ? null : signedOut ? (
                  <div className={styles.authActions}>
                    <button className="btn btn-secondary" onClick={logIn}>
                      Log in
                    </button>
                    <button className="btn btn-primary" onClick={logIn}>
                      Sign up
                    </button>
                  </div>
                ) : (
                  <>
                    <Link href="/portfolio" className={styles.balance}>
                      <span>Available</span>
                      {/* Balances roll to their new value after a trade. */}
                      <strong>
                        <Count value={availableCash(state)}>{usd(availableCash(state))}</Count>
                      </strong>
                    </Link>
                    <Link href="/portfolio" className={styles.balance}>
                      <span>Portfolio</span>
                      <strong>
                        <Count value={totals.totalCents}>{usd(totals.totalCents)}</Count>
                      </strong>
                    </Link>
                    <button
                      className={`btn btn-primary btn-icon ${styles.newPrediction}`}
                      onClick={() => setComposer(true)}
                      aria-label="Share your take"
                      data-tip="Share your take"
                    >
                      <Plus size={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <TraderTicker />
          </header>

          {/* Phones get the compact 06.2 header instead. */}
          <header className={styles.mobileHeader}>
            <Link href="/" className="brand" aria-label="imo home">
              <Image src="/brand/wordmark.png" alt="" width={58} height={28} className={styles.mobileLogo} priority />
            </Link>
            {demo && (
              <button
                className={`tag tag-accent ${styles.mobileDemo}`}
                onClick={() => setLab(true)}
                aria-label="Demo mode — open demo controls"
              >
                DEMO
              </button>
            )}
            {/* 02.2 · Discover carries its own search field. */}
            {!discover && (
              <Link
                href="/discover"
                className={`btn btn-icon ${styles.mobileAction}`}
                aria-label="Search markets"
              >
                <MagnifyingGlass size={20} />
              </Link>
            )}
            {!ready ? null : signedOut ? (
              <button className={`btn btn-primary btn-sm ${styles.mobileLogin}`} onClick={logIn}>
                Log in
              </button>
            ) : (
              <Link
                href="/notifications"
                className={`btn btn-icon ${styles.mobileAction}`}
                aria-label={
                  unread ? `Notifications, ${unread} unread` : "Notifications"
                }
              >
                <Bell size={20} />
                {unread > 0 && (
                  <span className={styles.mobileBadge} aria-hidden="true" />
                )}
              </Link>
            )}
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className={[
              styles.main,
              fullBleed ? styles.homeMain : "",
              panelled ? styles.panelMain : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {storageMessage && (
              <div className="storage-message" role="status">
                <Info size={16} />
                {storageMessage}
              </div>
            )}
            {notice && (
              <div className="global-notice" role="status">
                <Check size={16} />
                {notice}
                <button
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {shellLoading ? (
              home ? (
                <HomeLoading />
              ) : discover ? (
                <DiscoverLoading />
              ) : (
                <Skeleton />
              )
            ) : screen === "error" && !ownStates ? (
              <div className="state-preview">
                <Empty
                  title="The view is temporarily interrupted"
                  description="This is the demo error state. Your saved positions and predictions are safe."
                  action={
                    <Button
                      variant="primary"
                      onClick={() => setScreen("ready")}
                    >
                      Try again
                      <RotateCcw size={15} />
                    </Button>
                  }
                />
              </div>
            ) : screen === "empty" && !ownStates ? (
              <div className="state-preview">
                <Empty
                  title="A new perspective starts here"
                  description="This is the demo empty state. Find a market and make your first prediction."
                  action={
                    <Button
                      variant="primary"
                      onClick={() => setScreen("ready")}
                    >
                      Discover markets
                      <ArrowRight size={15} />
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="page-content" key={pathname}>
                {children}
              </div>
            )}
          </main>
        </div>
      </div>

      <nav className={styles.tabBar} aria-label="Mobile navigation">
        {tabs.map(({ label, href, Icon, match }) => (
          <Link
            key={href}
            href={href}
            aria-current={match(pathname) ? "page" : undefined}
          >
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <Composer open={composer} onOpenChange={setComposer} />
      <Modal
        open={demo && lab}
        onOpenChange={setLab}
        title="Your demo workbench"
        description="Explore the app’s states, or start again with a fresh account."
      >
        <div className="demo-lab">
          <label htmlFor="screen-state">Page state preview</label>
          <select
            id="screen-state"
            value={screen}
            onChange={(e) => setScreen(e.target.value)}
          >
            <option value="ready">Ready — normal content</option>
            <option value="loading">Loading — skeletons</option>
            <option value="empty">Empty — helpful starting point</option>
            <option value="error">Error — recoverable failure</option>
          </select>
          <p>
            Page previews are also available with ?state=loading, empty, or
            error. Open Demo controls to return to Ready.
          </p>
          <div className="notice">
            <Info size={16} />
            <p>
              Orders go to the paper engine on live prices: what fills, rests
              or fails is decided by the order book. A new season lives in
              Settings.
            </p>
          </div>
        </div>
      </Modal>
      <Modal
        open={about}
        onOpenChange={setAbout}
        title="Room to explore. Nothing to risk."
        description={
          sample
            ? "imo is a social prediction-trading demo."
            : "imo is a social prediction-trading app, in beta."
        }
      >
        <div className="about-demo">
          <Flask size={28} />
          <p>
            Discover a market, follow a trader’s reasoning, and form your own
            view. Every trade uses simulated USD
            {sample
              ? ". No real orders, deposits or payments exist in this version."
              : " against real market prices: no deposits, and no real orders."}
          </p>
          {sample ? (
            <p>
              Markets, price histories, people, positions, and performance are
              fictional illustrations based on a fixed September 25, 2026
              snapshot. {venueList("and")} are venue labels only; this demo is
              not affiliated with{" "}
              {venueIds.length === 2 ? "either venue" : "any of them"}.
            </p>
          ) : (
            <p>
              {shown.length
                ? `Prices and order books come from ${venueList("and", shown)}. imo isn’t affiliated with ${venueList("or", shown)}; `
                : "Prices and order books come from the venues themselves. imo isn’t affiliated with them; "}
              trading there with your own account comes after the beta.
            </p>
          )}
          <p>
            Your trades, predictions and follows are saved to your account and
            go with you to any device.
          </p>
          <Button
            variant="primary"
            className="full btn-split"
            onClick={() => setAbout(false)}
          >
            Find my perspective
            <ArrowRight size={16} />
          </Button>
          {signedOut && (
            <Button
              className="full"
              onClick={() => {
                setAbout(false);
                logIn();
              }}
            >
              Log in or sign up
            </Button>
          )}
        </div>
      </Modal>
      <SignInDialog />
    </div>
  );
}
export function HunchShell({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <Shell>{children}</Shell>
    </DemoProvider>
  );
}
