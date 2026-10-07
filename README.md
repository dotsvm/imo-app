<p align="center">
  <img src="docs/assets/banner.png" alt="imo — the social network for prediction markets" width="100%" />
</p>

<p align="center">
  <b>Make a call. Back it with real money. Let your record speak.</b><br/>
  imo turns prediction markets into a social network: people post their calls on real markets,
  others <i>Back</i> or <i>Fade</i> them with a trade, and every profile carries a track record
  that can't be faked, because it's settled on Solana.
</p>

<p align="center">
  <img alt="Solana" src="https://img.shields.io/badge/Solana-mainnet-9945FF?logo=solana&logoColor=white" />
  <img alt="Jupiter Predict" src="https://img.shields.io/badge/Jupiter-Predict-c7f284" />
  <img alt="Seeker" src="https://img.shields.io/badge/Solana%20Seeker-first-14F195" />
  <img alt="Expo" src="https://img.shields.io/badge/Expo-SDK%2057-000020?logo=expo&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <a href="https://github.com/dotsvm/imo-app/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dotsvm/imo-app/actions/workflows/ci.yml/badge.svg" /></a>
</p>

---

## Why imo

Prediction markets are the best real-time signal on what's going to happen, but they're lonely.
You see a price, not the people and the reasoning behind it, and anyone can claim they "called it"
after the fact.

imo fixes both:

- **Calls with skin in the game.** A post is a position on a real market, stamped with the price
  when it was made. When the market resolves, the call is marked right or wrong, publicly.
- **Back or Fade, in one tap.** Agree with a call? Back it. Think they're wrong? Fade it. Either way
  it's a real trade on the same market, from your own wallet.
- **Records that can't be faked.** P&L, hit rate and the leaderboard come from real fills and
  onchain settlement, not screenshots.
- **Rooms for people who trade the same things.** Team-chat rooms per topic, with the room's
  markets pinned on top and members' positions shown on their messages.

## How it works on Solana

imo trades on **[Jupiter Predict](https://jup.ag/prediction)**: Solana prediction markets that route
to Kalshi and Polymarket books and settle in USDC. Every trade is a transaction the trader signs on
their own device; imo never holds keys or funds.

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant App as imo app (phone)
    participant API as imo API
    participant J as Jupiter Predict
    participant S as Solana
    You->>App: Back "Fed cuts in December" for $10
    App->>API: POST /orders
    API->>J: build the order (owner, market, side, USDC)
    J-->>API: unsigned transaction + estimate
    API-->>App: transaction to sign
    App->>App: wallet signs on the device
    App->>API: POST /orders/{id}/submit (signed bytes)
    API->>API: message must match the build, byte for byte
    API->>J: execute
    J->>S: order lands, a keeper fills it
    API->>J: follow until filled
    API-->>App: filled: position, P&L and the post's "backed" count update
```

- **Non-custodial.** Each person gets an embedded Solana wallet (Privy) unlocked by their imo
  session. The key never reaches our servers.
- **Exactly what you saw.** The API only relays the transaction it built for you. A signed payload
  whose message differs is refused, so it can't be used to relay anything else.
- **Mirrored, not trusted.** Fills, positions, payouts and P&L are mirrored into Postgres (each venue
  fill exactly once) so feeds, profiles and the leaderboard stay fast and always come from real fills.
- **Deposit and withdraw USDC** to and from any Solana address, from inside the app.

## Screens

The mobile app (Expo) is the product, built for the **Solana Seeker** first, then iOS and Android.
The web app shares the same API and brings the same experience to desktop.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/home-375.png" width="200" /><br/><sub>Calls from people you follow</sub></td>
    <td align="center"><img src="docs/screenshots/market-375.png" width="200" /><br/><sub>A market: chart, book, discussion</sub></td>
    <td align="center"><img src="docs/screenshots/home-mobile-ticket.png" width="200" /><br/><sub>Back or Fade a call</sub></td>
    <td align="center"><img src="docs/screenshots/portfolio-375.png" width="200" /><br/><sub>Portfolio and positions</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/home-1440.png" width="100%" alt="imo on the web: leaderboard, feed and trending markets" />
  <br/><sub>The web app: top traders, the feed and trending markets side by side. Screenshots use the demo dataset.</sub>
</p>

## What's inside

A TypeScript monorepo (npm workspaces + Turborepo):

```
imo/
├── apps/
│   ├── mobile/      Expo (React Native) app: Seeker first, then iOS and Android
│   ├── web/         Next.js 16: the web app and the /api/v1 API every client shares
│   ├── worker/      Long-running jobs: venue feeds, order tracking, settlement, notifications
│   └── waitlist/    The claim-your-username site used before launch
├── packages/
│   ├── core/        Money, fees, quotes, market lifecycle. Pure and framework-free
│   ├── venues/      Venue SDK + adapters: Jupiter Predict, Kalshi, Polymarket
│   ├── domain/      Shared product types and the demo dataset
│   └── server/      Use cases, Postgres schema + migrations, ports and adapters
└── docs/            Architecture, deployment, verification, brand
```

```mermaid
flowchart LR
  mobile["apps/mobile<br/>Expo"] -- "HTTPS /api/v1" --> web
  web["apps/web<br/>Next.js API + web"] --> server
  worker["apps/worker"] --> server
  server["packages/server<br/>use cases · DB · adapters"] --> venues
  server --> core
  venues["packages/venues<br/>Jupiter · Kalshi · Polymarket"] --> core["packages/core"]
  server --> pg[(Postgres)]
  venues --> jup["Jupiter Predict"]
  jup --> sol[("Solana")]
```

**Pluggable by design.** Venues, data sources, wallets and infrastructure sit behind ports
(`packages/venues/src/sdk`, `packages/server/src/composition`). Adding a venue is a module and a line
of configuration, with no changes to the core or the apps. Package boundaries are enforced by ESLint:
the core imports nothing, and venue modules import only the core and the SDK.
See [docs/architecture/extensibility.md](docs/architecture/extensibility.md).

## Tech

| Area | Stack |
| --- | --- |
| Mobile | Expo SDK 57 · React Native 0.86 (New Architecture) · Expo Router · Reanimated 4 · TanStack Query |
| Web + API | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 |
| Solana | Jupiter Predict API · `@solana/kit` · Privy embedded wallets |
| Data | Postgres (Supabase) · Drizzle ORM · transactional outbox · leased worker lanes |
| Auth | Supabase (email code, Google, Apple) · Privy custom auth on Supabase's JWKS |
| Quality | Strict TypeScript · ESLint boundaries · node:test + fast-check · Playwright · GitHub Actions |

## Quick start

**Requirements:** Node 22+ (24 recommended) and Postgres 14+.

```bash
git clone https://github.com/dotsvm/imo-app.git imo && cd imo
npm install
cp .env.example .env.local          # the demo profile needs only DATABASE_URL

createdb imo_dev
DIRECT_URL=postgres://localhost:5432/imo_dev npm run db:migrate

npm run dev                          # web + API on http://localhost:3000
npm run worker                       # feeds, order tracking, settlement (second terminal)
```

The **demo profile** (the default) runs on a built-in dataset with dev sign-in, so no keys are
needed. For real markets and real trading, set `APP_PROFILE=production` plus Supabase, Privy and
`JUPITER_API_KEY` (see `.env.example` and [docs/deploy.md](docs/deploy.md)).

**Mobile app:**

```bash
cd apps/mobile && npm install
cp .env.example .env.local          # EXPO_PUBLIC_API_URL=http://<your LAN IP>:3000
npx expo start                      # Expo Go to browse; a development build to trade
```

Trading signs with native wallet modules, so it needs a development build
(`eas build --profile development --platform android`) rather than Expo Go.
More in [apps/mobile/README.md](apps/mobile/README.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app + API |
| `npm run worker` | Background worker |
| `npm run verify` | Typecheck, lint and unit tests across every package (Turborepo) |
| `npm run test:db` | API integration tests against Postgres (`DATABASE_URL=…/hunch_test`) |
| `npm run test:e2e` | Browser end-to-end tests (Playwright) |
| `npm run db:generate` · `npm run db:migrate` | Create · apply database migrations |
| `npm run mobile` | Start the Expo app |

## Quality

- **150+ unit tests:** money math (property-based, with fast-check), quotes, fees, venue adapters
  against recorded payloads, and Jupiter execution (order builds, signer checks, fills, claims).
- **110+ API integration tests** against a real Postgres: trading, settlement, rooms, social,
  permissions, and the whole wallet flow (build, sign, submit, fill, sell, claim, withdraw).
- **End-to-end browser tests** with accessibility checks (axe).
- CI runs types, lint, unit and database tests, the mobile app's checks, and a dependency audit
  on every push.

## Security

- No keys or funds on our servers: every trade, sale, claim and withdrawal is signed on the user's device.
- Server-built transactions only: a submitted transaction must match what was built for that user.
- Venue API keys stay on the server; the app never ships them.
- Uploads are checked on the server (type, size, ownership) before anything points at them.
- Secrets live in environment variables only; `.env*` files are never committed.

## Status

Working today: the social layer (feed, posts, Back/Fade, rooms, watchlists, leaderboard,
notifications), Jupiter Predict market data, and real-money trading from the embedded wallet
(buy, sell, claim, deposit, withdraw). Next: Seed Vault signing on the Seeker, push notifications,
and the Solana dApp Store release.

---

<p align="center"><sub>© 2026 imo. All rights reserved.</sub></p>
