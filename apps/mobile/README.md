# imo mobile

The imo app for Solana Seeker (first), then iOS and Google Play. Expo SDK 57, Expo Router,
React Native 0.86, on the same `/api/v1` as the web app.

## Run it

```bash
cd apps/mobile
npm install
cp .env.example .env.local   # point EXPO_PUBLIC_API_URL at a running imo API
npx expo start               # i = iOS simulator, a = Android, w = web
```

This app is **not** an npm workspace of the repo root: Expo pins React to the exact version
React Native ships with, and the web app runs a newer patch. It has its own `node_modules`
and lockfile. Add packages with `npx expo install <pkg>` so versions match the SDK.

Trading signs with the trader's wallet, which needs native modules: use a development build,
not Expo Go (Expo Go still runs everything else, and says why it can't trade).

```bash
# apps/mobile isn't tracked by git yet, so upload the folder itself
EAS_NO_VCS=1 npx eas-cli@latest build --profile development --platform android
npx expo start --dev-client   # then open the installed imo dev app
```

## Real money

On a server with `TRADING=wallet` (production and staging by default) every trade is real:

- **Wallet:** Privy's embedded Solana wallet, created at sign-in and unlocked on the device
  with the imo session (Privy custom auth on Supabase's JWKS). The key never reaches our
  server. Privy dashboard → Clients → a mobile client allowing `xyz.tryimo.app` and the `imo`
  scheme; its id is the server's `PRIVY_MOBILE_CLIENT_ID`.
- **Trades:** Jupiter Predict on Solana mainnet, in USDC, $5 minimum. `POST /orders` returns
  Jupiter's transaction, the wallet signs it here, `POST /orders/{id}/submit` lands it, and
  `GET /orders/{id}` follows the fill. Sells and claims work the same way.
- **Funding:** Me → Settings → Wallet shows the address (QR) and its USDC and SOL.

## Sign-in

The app signs in on the device and sends the session's access token to `/api/v1` as a bearer
token. Which ways in appear comes from `GET /api/v1/config`; switched-off ones are hidden.

- **Email:** Supabase emails a 6-digit code (`packages/server/supabase/templates` carry `{{ .Token }}`).
- **Google, X, Apple off iOS:** Supabase's page in an in-app browser. Add the app's return
  address to Supabase → Authentication → URL Configuration → Redirect URLs:
  `imo://auth-callback` for builds, and `exp://**` while testing in Expo Go.
- **Apple on iOS:** the system sheet; its ID token is checked by Supabase.
- **Local API (`APP_PROFILE=demo`):** dev sign-in, any email straight in, no code.

Then `/me` routes the account: invite code (beta gate) → interests → follow callers → Home.

## Builds

| Profile       | Output                         | For                                  |
| ------------- | ------------------------------ | ------------------------------------ |
| `development` | dev client (APK on Android)    | day-to-day work on a device          |
| `seeker`      | signed APK                     | the Solana dApp Store (needs an APK) |
| `production`  | AAB / IPA                      | Google Play and the App Store        |

## Layout

- `apps/web/src/app/` — routes (Expo Router). `(tabs)/` is the tab bar: Home, Discover, Rooms,
  Portfolio, Profile.
- `apps/web/src/features/` — screens' parts and data hooks, per feature.
- `apps/web/src/components/` — shared UI (tab bar, pressable, skeleton…).
- `src/lib/` — the API client, session token, formatting, venues.
- `src/theme/tokens.ts` — colors, radii, type, motion; mirrors `apps/web/src/app/globals.css` on web.

API response types are imported (types only) from the server: `@/server/dto/api-types`.
A server change that breaks the app fails `npm run typecheck` here.

## Checks

```bash
npm run typecheck && npm run lint
```
