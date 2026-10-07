/**
 * Deployment configuration, validated once at boot. A bad value stops the
 * process with every problem listed, rather than failing inside a request.
 * Provider keys are optional here; the composition root decides whether a
 * missing one is fine (demo, test) or fatal (production, staging).
 */
import { z } from "zod";

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

const optional = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

const Env = z.object({
  APP_PROFILE: z
    .enum(["production", "staging", "test", "demo"])
    .default("demo"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** The waitlist app (apps/waitlist), where people claim a username while
      the beta is closed; unset, the app doesn't point there. */
  WAITLIST_URL: optional.pipe(z.url().optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_SECRET: optional,

  DATABASE_URL: optional,
  DIRECT_URL: optional,

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
  SUPABASE_SECRET_KEY: optional,

  NEXT_PUBLIC_PRIVY_APP_ID: optional,
  PRIVY_APP_SECRET: optional,
  /** The native apps' Privy client (dashboard → Clients), allowed for
      xyz.tryimo.app and the imo:// scheme. Public, like the app id. */
  PRIVY_MOBILE_CLIENT_ID: optional,

  /** Google sign-in on our own domain (the OAuth client Supabase's Google
      provider uses). Unset: Google sign-in goes through Supabase's page. */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  /** Venue hosts adapters may call; configured providers add their own. Everything else is refused. */
  EGRESS_ALLOW: list(
    [
      "gamma-api.polymarket.com",
      "clob.polymarket.com",
      "data-api.polymarket.com",
      "external-api.kalshi.com",
      "external-api.demo.kalshi.co",
      "api.jup.ag",
    ].join(","),
  ),
  KALSHI_ENV: z.enum(["demo", "production"]).default("demo"),
  /** Data sources to run (ingestion, books, streams), by source id. Unset:
      demo → the design dataset; production → the live venues. */
  DATA_SOURCES: optional.transform((v) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  ),
  KALSHI_API_KEY_ID: optional,
  KALSHI_PRIVATE_KEY: optional,

  UPSTASH_REDIS_REST_URL: optional,
  UPSTASH_REDIS_REST_TOKEN: optional,

  /** Supabase Storage bucket for avatars and evidence images (public). */
  SUPABASE_STORAGE_BUCKET: z.string().default("media"),
  /** Where uploads live without Supabase (development, self-hosting). */
  LOCAL_STORAGE_DIR: z.string().default(".data/uploads"),

  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("imo <hello@example.com>"),

  SENTRY_DSN: optional,
  NEXT_PUBLIC_POSTHOG_KEY: optional,
  NEXT_PUBLIC_POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),

  /** People who get the admin role on first sign-in (verified emails only). */
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),

  /** How trades execute: `wallet` (real money, the trader's own wallet signs
      venue transactions) or `paper` (simulated fills on live books). Unset:
      wallet in production and staging, paper elsewhere. */
  TRADING: z.enum(["wallet", "paper"]).optional(),
  /** Solana JSON-RPC for wallet balances. The public endpoint is rate-limited;
      use a provider's (Helius, Triton…) in production. */
  SOLANA_RPC_URL: z.url().default("https://api.mainnet-beta.solana.com"),

  /** Starting paper balance, in whole dollars. */
  PAPER_STARTING_BALANCE: z.coerce.number().int().positive().default(10_000),

  /** Multiplies the per-person API budgets (api:*): above 1 for load tests
      and the end-to-end suite, which reloads pages far faster than people. */
  API_RATE_SCALE: z.coerce.number().positive().max(1_000).default(1),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success)
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const supabaseConfigured = (c: Config) =>
  !!(c.NEXT_PUBLIC_SUPABASE_URL && c.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export const privyConfigured = (c: Config) =>
  !!(c.NEXT_PUBLIC_PRIVY_APP_ID && c.PRIVY_APP_SECRET);

/** Real money from the trader's wallet, or paper. */
export const tradingMode = (c: Config): "wallet" | "paper" =>
  c.TRADING ?? (c.APP_PROFILE === "production" || c.APP_PROFILE === "staging" ? "wallet" : "paper");
