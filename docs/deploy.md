# Deploying Hunch

Three pieces: the web app and API on **Vercel**, the **worker** on any host that runs a
long-lived process (Fly.io or Railway), and **Supabase** for Postgres, auth, realtime and storage.
Everything else is optional and switches on with its keys.

Set `APP_PROFILE=production` (or `staging`) on both the web app and the worker. In those profiles a
missing required key stops boot with the list of what's missing — nothing falls back to a local
twin.

## 1. Supabase

1. Create a project in the region nearest your users (the web app and worker should sit beside it).
2. **Database.** Project settings → Database → connection strings:
   - `DATABASE_URL`: the transaction pooler (port 6543), for the web app.
   - `DIRECT_URL`: the direct connection (port 5432), for migrations and the worker (realtime
     listening and leases need a session).
   - Apply migrations from your machine or CI: `DIRECT_URL=… npm run db:migrate`.
3. **API keys.** Project settings → API: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` (server only — never in a
   `NEXT_PUBLIC_` variable).
4. **Auth.**
   - URL configuration: Site URL = your `APP_URL`; Redirect URLs =
     `https://<your-domain>/api/v1/auth/callback` (add `http://localhost:3000/api/v1/auth/callback`
     for local work against this project).
   - Providers: **Google** (OAuth client from Google Cloud; its authorized redirect URI is
     `https://<project>.supabase.co/auth/v1/callback`), **Web3 wallet** (Solana and Ethereum), and
     **Email** (magic link).
5. **Storage.** Create a public bucket named `media` (or set `SUPABASE_STORAGE_BUCKET`). Uploads go
   straight from the browser on signed tickets; the API checks what arrived before using it.
6. **Realtime.** Nothing to configure: the `hunch_listen` policy (migration 0006) authorizes the
   private `user:` and `room:` topics; markets and predictions are public topics.

## 2. Privy (embedded wallets)

Create an app, then set custom auth (JWT) to Supabase's JWKS:
`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. Set `NEXT_PUBLIC_PRIVY_APP_ID` and
`PRIVY_APP_SECRET`. Each person gets self-custodial Solana and Ethereum wallets on first sign-in;
Hunch never holds keys.

## 3. The web app on Vercel

Import the repository. Framework, build and output are detected (Next.js). Set the environment:

| Variable                                                                         | Value                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `APP_PROFILE`                                                                     | `production`                                     |
| `APP_URL`                                                                         | `https://<your-domain>` (HTTPS turns on HSTS)    |
| `SESSION_SECRET`                                                                  | 32+ random bytes: `openssl rand -base64 48`      |
| `DATABASE_URL`, `DIRECT_URL`                                                      | from Supabase (above)                            |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | from Supabase                          |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`                                   | from Privy                                       |
| `RESEND_API_KEY`, `EMAIL_FROM`                                                    | Resend, with your sending domain verified        |
| `KALSHI_ENV`                                                                      | `demo` until Kalshi's written data consent arrives (market data needs no API key) |
| `DATA_SOURCES`                                                                    | `polymarket-public` until Kalshi's consent is recorded; then add `kalshi-direct` |
| `ADMIN_EMAILS`                                                                    | your sign-in email(s)                            |
| Optional: `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` | shared rate budgets, errors, product analytics |

`.env.example` documents every variable. Put the region beside Supabase.

## 4. The worker

The worker runs every schedule: venue catalogs and prices, order books for watched markets, maker
matching, settlement, the outbox relay (notifications, realtime, email), digests and pruning. It
needs the same environment as the web app, `NEXT_PUBLIC_*` included (Supabase's URL for realtime
and storage, Privy's app id for wallets). Give it Supabase's **session pooler** string (port 5432)
as `DATABASE_URL`: it holds its connections open, and the pooler reaches IPv4-only hosts.

A venue's data is fetched only while its display rights are on in the `venues` table (Kalshi's are
off until Kalshi's written consent; record it with the admin API, `displayAllowed: true`).

- **Fly.io:** `fly apps create hunch-worker`, set `primary_region` in `apps/worker/fly.toml` to the
  region nearest the database (Supabase in ap-northeast-2 → `nrt`), import the secrets
  (`fly secrets import -a hunch-worker --stage < worker.env`, never echoed), then
  `fly deploy --config apps/worker/fly.toml --ha=false`. The image runs Node directly
  (`node --import tsx`) so SIGTERM reaches it: lanes get 20 seconds to finish and every lease
  is handed back, so a redeploy never waits out a lease.
- The first catalog pass backfills every open market (several thousand for Polymarket, a few
  minutes); later passes skip markets whose details haven't changed and only reprice.
- **Railway:** new service from this repository, Dockerfile path `apps/worker/Dockerfile`, the same
  variables.

More than one replica is safe: exclusive lanes hold leases, and jobs are claimed with
`SKIP LOCKED`. On SIGTERM the worker finishes lanes in flight and hands its leases back.

## 5. After the first deploy

1. Sign in with Google using an address in `ADMIN_EMAILS` — you're the admin.
2. The private beta's gate is on by default in production. People claim a username on the
   waitlist app (Google or an emailed link — a real account holds each handle) and see their
   place in line; the `waitlist` table links each entry to its account. Issue invites from the
   admin API (`POST /api/v1/admin/invites`) or invite people from the waitlist; members get
   three invites each.

## The waitlist app

`apps/waitlist` is its own Next.js app (an npm workspace) on the same database and Supabase
project; its `/api/v1` routes re-export the main app's handlers. Deploy it as a second Vercel
project from this repository:

- **Root Directory** `apps/waitlist` (Vercel installs from the repository root, where the
  workspaces and lock file live, and builds the app with the shared `src/` code).
- **Environment:** the web app's variables (database, Supabase, Upstash, Sentry…), plus
  `APP_URL` = the waitlist's own address and `MAIN_APP_URL` = the web app's.
- **Supabase → Authentication → URL Configuration:** add
  `https://<waitlist domain>/api/v1/auth/callback` to the redirect URLs, or Google and emailed
  links land on the web app instead.
- On the web app, set `WAITLIST_URL` so its "invite-only" dialog links to the waitlist.
3. Smoke test: sign in (Google, a wallet, an emailed link), place and cancel a limit order, post a
   prediction, send a room message from two browsers (it should arrive live), upload a photo, and
   check a notification email arrives.

## CI

`.github/workflows/ci.yml` runs types, lint, unit and database tests and a dependency audit, then
the end-to-end suite against a full stack, on every push to `main` and every pull request.
Protect `main` on both checks.
