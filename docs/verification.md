# Verification report

Checked on September 30, 2026, on macOS with native Postgres 14 and Google Chrome. Every result
below comes from running the suites against real services — the API, the worker and Postgres — not
mocks.

| Check                     | Result                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `tsc` (strict)            | Passed — no errors                                                                       |
| `eslint`                  | Passed — no errors or warnings                                                           |
| Unit tests (`npm test`)   | 109 passed — core money and fees, venue modules, adapters and conformance kits, auth     |
| Database tests            | 99 passed — every API route through its real handler against Postgres                    |
| End-to-end (`test:e2e`)   | 72 passed — production build, worker and a freshly seeded database                       |
| Accessibility             | No axe violations (WCAG 2 A/AA, 2.1 AA) on 33 routes at three widths and the phone sheets |
| Responsive layout         | Every route at 1440, 768 and 375 CSS pixels: no horizontal overflow, no console errors   |
| `npm audit --omit=dev`    | 0 vulnerabilities                                                                        |

## What the end-to-end suite covers

**Design** (as the seeded trader, reading only): every route at three widths; the home terminal's
layout, resizable panels and URL-backed filters; Discover's search, tabs, categories and venue
filter; a market's chart, book, tape and discussion; a prediction's thread and reply filters; a
position's two settlement outcomes; leaderboard filters and the 10-resolved floor; rooms' unread
counts, day rules, threads, mentions, join lines and holding pills; invite-only covers; dropdowns,
independent column scrolling, batch loading and composer drafts.

**Flows** (fresh paper traders, two where a flow needs another person):

- Sign-in: sign out, sign in with an address, onboarding through to the feed, signed-out pages
  returning after sign-in, expired links, the demo trader.
- Trading: the design's $100 ticket to the cent, place and reload, sell, activity; validation
  (minimum, balance whatever the book's depth, holdings); resting limits that hold and release
  cash; a partial fill at the book's depth; a moved price asking again; hold-to-place on phones;
  Back and Fade from the feed.
- Social: publishing a prediction, likes, bookmarks, replies, following, the Following and Saved
  feeds; live notifications between two people; share and report.
- Rooms: joining, messages with linked markets, threads, waves, mentions, offline retry, running
  and archiving a room, invite-only requests approved by an owner, messages arriving live in
  another member's browser.
- Watchlists: named lists created, renamed, reordered, shared to a room and deleted; swipe to
  remove on phones; saving from a market's header and from Discover.
- Settings: fields saved on blur, a taken handle refused, privacy hiding you from the board,
  notification preferences with the locked failure alert, price alerts, a new season with its
  30-day cooldown, photo upload and removal.
- The seeded trader's settled payout claimed to cash, once.

## Bugs the suite found (all fixed)

Position pages that never opened; a request storm on cold starts that tripped rate limits and
then looked like signing out; room feeds requested for rooms you weren't in, which took every
other live update down; holding pills with no data behind them; invite-only rooms showing
outsiders nothing; a stale room reload undoing a fresh change; room creation navigating to
`[object Promise]`; resting limits with an all-zero quote; amounts over the balance reaching
review; unrounded average prices; a follow button without a name while pointed at; an activity
column the keyboard couldn't scroll.

## Production shows only real data

Checked September 30, 2026. In the production profile every number on screen comes from a venue or
from people's own activity:

- **Charts:** a market's price chart and a position's "price since entry" draw the venue's own
  history (cached on the server for 1–30 minutes), with fills placed at the time they happened.
  Profiles plot cumulative P&L from daily equity for every period; with too little history they say
  so instead of drawing a curve.
- **Prices:** no invented 50¢ or ±1¢ spreads; an open market the venue hasn't priced stays out of
  listings, and an empty side of the book shows the venue's own price.
- **Accounts:** starting balance, season and reset cooldown come from the server; claimable payouts
  are the settlement's (void markets pay 50¢); a claim shows the server's receipt; Back/Fade and the
  ticket report what actually filled, at the real average price, without an artificial delay.
- **People:** leaderboard rank, the board's update time, room presence (seen in the last five
  minutes) and Hunch holder counts are the server's; avatars without a photo are initials on the
  person's own color (no third-party avatar service).
- **The demo's workbench** (DEMO tag, demo controls, `?state=` previews, the design dataset) exists
  only in the demo profile, which the test suites use.
- **Kalshi** data is never fetched while its display rights are off (worker lanes skip it; a DB test
  covers this), so production lists Polymarket only until Kalshi's consent is recorded.

A production build on an empty database (the state before the worker's first sync) was swept at
1440 and 375 pixels across every route: no crashes, no overflow, and honest empty states ("Markets
are on their way", "No ranked traders yet", "No rooms yet") instead of placeholders.

## Live on real data

The worker runs on Fly (Tokyo, beside the Supabase database in Seoul) against Polymarket's public
APIs: the first catalog pass stored over 15,000 open markets, tagged into Hunch's categories
(Politics, Sports, Crypto, Culture, Tech, Economics…), with live quotes, trending ranks and
realtime price updates. First contact found and fixed three adapter issues: tags only arrive when
asked for (`include_tag=true`), some markets carry only a date-only end or their event's, and one
bad row no longer stops a page.

## Not yet verified live

These need provider keys, and are covered by contract tests and stand-ins until then: Google, wallet
and emailed-link sign-in through Supabase; Supabase Realtime and Storage; Privy wallet creation;
Resend delivery; Upstash; Sentry and PostHog; Kalshi's and Polymarket's production APIs (this
network's DNS blocks their hosts; Kalshi's demo exchange was used live).
