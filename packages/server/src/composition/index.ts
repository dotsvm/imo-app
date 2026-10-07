/**
 * The composition root: the one place that knows which adapter backs which
 * port. Everything else receives `Deps` and never imports an adapter, so a
 * provider or venue changes here and nowhere else.
 *
 * Profiles:
 * - production, staging — real providers only. A missing one fails loudly,
 *   never silently falls back to memory.
 * - demo — real network and database; the dev identity and dev wallets fill
 *   in for providers without keys yet.
 * - test — no network, manual clock, the fixture venue.
 */
import type {
  Cache,
  EventBus,
  FeatureFlags,
  JobQueue,
  Mailer,
  ObjectStorage,
  RealtimeFeed,
  RealtimePublisher,
  RealtimeTransport,
} from "@imo/core/ports/platform";
import type {
  Analytics,
  Clock,
  ErrorReporter,
  HttpClient,
  Logger,
  RateLimiter,
  SecretReader,
} from "@imo/core/ports/runtime";
import type {
  ExternalIdentity,
  GoogleSignIn,
  IdentityProvider,
  RequestCredentials,
  SignInMethods,
  SignInReturn,
  WalletProvider,
} from "@imo/core/ports/identity";
import type { DataSourceId, VenueId } from "@imo/core/market";
import { createFetchClient } from "../adapters/http/fetch-client";
import { DevIdentity } from "../adapters/identity/dev";
import { GoogleOAuth } from "../adapters/identity/google";
export { DEV_SESSION_COOKIE } from "../adapters/identity/dev";
import { SupabaseIdentity } from "../adapters/identity/supabase";
import { ScriptedHttp } from "../adapters/memory/http";
import {
  MemoryCache,
  MemoryEventBus,
  MemoryFlags,
  MemoryJobQueue,
  MemoryMailer,
  MemoryRealtime,
  MemoryStorage,
} from "../adapters/memory/platform";
import {
  createLogger,
  jsonStdoutLogger,
  ManualClock,
  memorySecrets,
  systemClock,
  TokenBucketLimiter,
  type Budget,
  type LogLine,
} from "../adapters/memory/runtime";
import { PgCache } from "../adapters/postgres/cache";
import { PgFlags } from "../adapters/postgres/flags";
import { PgRateLimiter } from "../adapters/postgres/rate-limiter";
import { UpstashCache, UpstashRateLimiter } from "../adapters/upstash/redis";
import { PgJobQueue } from "../adapters/postgres/jobs";
import { RESEND_HOSTS, ResendMailer } from "../adapters/mail/resend";
import { LogReporter, SentryReporter, parseDsn } from "../adapters/observability/sentry";
import { MemoryAnalytics, PostHogAnalytics } from "../adapters/observability/posthog";
import { PgRealtime } from "../adapters/postgres/realtime";
import { SupabaseBroadcast } from "../adapters/realtime/supabase";
import { LocalDiskStorage } from "../adapters/storage/local-disk";
import { SupabaseStorage } from "../adapters/storage/supabase";
import { DevWallets, PRIVY_HOSTS, PrivyWallets } from "../adapters/wallets/privy";
import { SolanaRpc } from "../adapters/solana/rpc";
import type { ChainReader } from "@imo/core/ports/chain";
import { createDatabase, type Database } from "../db/client";
import { designSource } from "../demo/design-source";
import { renderMail } from "../mail/templates";
import {
  createKalshiSource,
  kalshiDemoSource,
  kalshiProductionSource,
} from "@imo/venues/kalshi/source";
import { createJupiterSource, jupiterSource } from "@imo/venues/jupiter/source";
import { EXECUTION_MODULES } from "@imo/venues/execution-catalog";
import type { ExecutionModule, ExecutionVenue } from "@imo/venues/sdk/execution";
import { createPolymarketSource, polymarketSource } from "@imo/venues/polymarket/source";
import type { AdapterContext, DataSourceModule } from "@imo/venues/sdk/source";
import { VENUE_CATALOG } from "@imo/venues/catalog";
import { fixture } from "@imo/venues/fixture/manifest";
import {
  createFixtureVenue,
  fixtureSource,
  type FixtureVenue,
} from "@imo/venues/fixture/source";
import type { VenueManifest } from "@imo/venues/sdk/manifest";
import type { MarketDataSource } from "@imo/venues/sdk/source";
import {
  loadConfig,
  privyConfigured,
  tradingMode,
  supabaseConfigured,
  type Config,
} from "./config";

export type Profile = Config["APP_PROFILE"];

/** The flag that closes the app to anyone without beta access. */
export const BETA_GATE = "beta_gate";

export interface Deps {
  profile: Profile;
  config: Config;
  clock: Clock;
  log: Logger;
  http: HttpClient;
  rateLimiter: RateLimiter;
  secrets: SecretReader;
  cache: Cache;
  jobs: JobQueue;
  events: EventBus;
  realtime: RealtimePublisher;
  /** Server-side listening, when the API relays realtime itself (SSE). */
  realtimeFeed?: RealtimeFeed;
  /** What browsers are told to connect to (GET /api/v1/config). */
  realtimeTransport: RealtimeTransport;
  mailer: Mailer;
  storage: ObjectStorage;
  flags: FeatureFlags;
  /** Unexpected failures (Sentry when configured). */
  errors: ErrorReporter;
  /** Product events (PostHog when configured). */
  analytics: Analytics;
  /** Postgres, when configured. The API needs it; pure unit tests don't. */
  database?: Database;
  identity: IdentityProvider;
  /** Google sign-in on our own domain, when its OAuth client is configured. */
  google?: GoogleSignIn;
  /** The dev identity, when enabled (demo and test only): issues sessions. */
  devIdentity?: DevIdentity;
  /** Embedded-wallet provider; null when none is configured. */
  wallets: WalletProvider | null;
  /** Reads wallet balances onchain; null outside wallet trading. */
  chain: ChainReader | null;
  venues: {
    manifests: readonly VenueManifest[];
    /** Running data sources, by source id — a market names its source. */
    sources: ReadonlyMap<DataSourceId, MarketDataSource>;
    /** Sources whose feeds the worker runs (catalog, prices, status). The
        design dataset is seeded, not fed; the fixture feeds only in tests. */
    feeds: readonly DataSourceId[];
    /** The venues each source serves, as its module declares them. */
    served: ReadonlyMap<DataSourceId, readonly VenueId[]>;
    /** Present in test and demo profiles: drive the fixture venue. */
    fixture?: FixtureVenue["control"];
    /** Venues that trade with the trader's own wallet, by venue id. */
    execution: ReadonlyMap<VenueId, { module: ExecutionModule; venue: ExecutionVenue }>;
  };
  /** Ports with no production adapter configured yet. */
  unprovisioned: readonly string[];
  /** Close pools and listeners. */
  close(): Promise<void>;
}

/** Request budgets, in each venue's own token units. Kalshi charges 10 tokens
    per default request against a 200-token/s Basic read budget. */
/** Every data source module this build knows, by id: which venues each serves. */
const SERVED: ReadonlyMap<DataSourceId, readonly VenueId[]> = new Map(
  (
    [
      designSource,
      kalshiDemoSource,
      kalshiProductionSource,
      polymarketSource,
      jupiterSource,
      fixtureSource,
    ] satisfies DataSourceModule[]
  ).map((module) => [module.id, module.venues]),
);

export const RATE_BUDGETS: Record<string, Budget> = {
  "kalshi:read": { perSecond: 200, capacity: 600 },
  "polymarket:read": { perSecond: 10, capacity: 30 },
  // Keyless reads are tightly limited (429s past ~1/s); an API key raises it.
  "jupiter:read": { perSecond: 1, capacity: 4 },
  // Orders, statuses and positions: one org-wide quota with reads, so keep
  // the sum inside the plan (Free 1/s, Developer 10/s).
  "jupiter:trade": { perSecond: 2, capacity: 6 },
  "fixture:read": { perSecond: 1_000, capacity: 1_000 },
  "privy:write": { perSecond: 5, capacity: 10 },
  // The public mainnet RPC allows ~10/s per IP; a provider's key allows more.
  "solana:rpc": { perSecond: 5, capacity: 10 },
  // Per person (or per IP when signed out), each with a bucket of its own.
  // A cold start of the app reads ~30 things at once; a few tabs or quick
  // reloads must fit.
  "api:read": { perSecond: 30, capacity: 150 },
  "api:write": { perSecond: 3, capacity: 15 },
  "api:order": { perSecond: 2, capacity: 10 },
  "api:auth": { perSecond: 0.2, capacity: 5 },
};

/** The per-person API budgets times `scale`; venue budgets are the venues'. */
export function scaleApiBudgets(budgets: Record<string, Budget>, scale: number) {
  if (scale === 1) return budgets;
  return Object.fromEntries(
    Object.entries(budgets).map(([key, b]) =>
      key.startsWith("api:") ? [key, { perSecond: b.perSecond * scale, capacity: Math.ceil(b.capacity * scale) }] : [key, b],
    ),
  );
}

/** A port that isn't provisioned fails loudly on first use, never silently. */
function unprovisioned<T extends object>(port: string): T {
  return new Proxy({} as T, {
    get(_target, key) {
      if (key === "then") return undefined; // not a thenable
      throw new Error(
        `${port} is not provisioned for this deployment (tried to use .${String(key)}). ` +
          `Configure its adapter in packages/server/src/composition.`,
      );
    },
  });
}

const envSecrets = (env: Record<string, string | undefined>): SecretReader => ({
  get: async (name) => env[name],
});

/** Try each provider in order; the first to recognize the request wins. */
class IdentityChain implements IdentityProvider {
  readonly id: string;
  /** Starting a sign-in (a social provider, an emailed link) belongs to the
      first provider that can; with none that can, the chain can't either. */
  readonly startSignIn?: IdentityProvider["startSignIn"];
  readonly sendSignInLink?: IdentityProvider["sendSignInLink"];
  readonly signInWithIdToken?: IdentityProvider["signInWithIdToken"];
  constructor(private readonly providers: IdentityProvider[]) {
    this.id = providers.map((p) => p.id).join("+");
    const starter = providers.find((p) => p.startSignIn);
    if (starter?.startSignIn) this.startSignIn = starter.startSignIn.bind(starter);
    const sender = providers.find((p) => p.sendSignInLink);
    if (sender?.sendSignInLink) this.sendSignInLink = sender.sendSignInLink.bind(sender);
    const tokens = providers.find((p) => p.signInWithIdToken);
    if (tokens?.signInWithIdToken) this.signInWithIdToken = tokens.signInWithIdToken.bind(tokens);
  }
  async resolve(
    credentials: RequestCredentials,
  ): Promise<ExternalIdentity | null> {
    for (const provider of this.providers) {
      const identity = await provider.resolve(credentials);
      if (identity) return identity;
    }
    return null;
  }
  async completeSignIn(returned: SignInReturn, credentials: RequestCredentials) {
    for (const provider of this.providers)
      if (await provider.completeSignIn?.(returned, credentials)) return true;
    return false;
  }
  /** Every provider: someone may hold more than one session. */
  async signOut(credentials: RequestCredentials) {
    for (const provider of this.providers) await provider.signOut?.(credentials);
  }
  async signInMethods(): Promise<SignInMethods> {
    const all = await Promise.all(this.providers.map((p) => p.signInMethods?.() ?? {}));
    return Object.assign({}, ...all) as SignInMethods;
  }
}

/** Tests and local development may run without a secret; never production. */
export const DEV_SECRET = "local-dev-secret-not-for-production-use-000000";

export interface CreateDepsOptions {
  env?: Record<string, string | undefined>;
  clock?: Clock;
  logSink?: (line: LogLine) => void;
  /** Worker and web open separate pools, named for monitoring. */
  application?: string;
}

export function createDeps(options: CreateDepsOptions = {}): Deps {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const profile = config.APP_PROFILE;
  const live = profile === "production" || profile === "staging";
  const test = profile === "test";
  const clock = options.clock ?? (test ? new ManualClock() : systemClock);
  const log = options.logSink
    ? createLogger(options.logSink, { level: config.LOG_LEVEL, clock })
    : test
      ? createLogger(() => {}, { clock })
      : jsonStdoutLogger(config.LOG_LEVEL);

  const missing: string[] = [];
  const pick = <T extends object>(port: string, memory: () => T): T => {
    if (!live) return memory();
    missing.push(port);
    return unprovisioned<T>(port);
  };

  // Configured providers are reachable without listing their hosts again.
  const upstash =
    config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN
      ? { url: config.UPSTASH_REDIS_REST_URL, token: config.UPSTASH_REDIS_REST_TOKEN }
      : undefined;
  const providerHosts = [
    config.NEXT_PUBLIC_SUPABASE_URL,
    upstash?.url,
    config.NEXT_PUBLIC_POSTHOG_KEY ? config.NEXT_PUBLIC_POSTHOG_HOST : undefined,
  ]
    .filter((u): u is string => !!u)
    .map((u) => new URL(u).hostname);
  if (config.SENTRY_DSN) providerHosts.push(parseDsn(config.SENTRY_DSN).host.split(":")[0]!);
  // Adapters with fixed hosts: allowed when their provider is configured.
  if (privyConfigured(config)) providerHosts.push(...PRIVY_HOSTS);
  if (config.RESEND_API_KEY) providerHosts.push(...RESEND_HOSTS);
  // Wallet trading reads balances over Solana RPC and trades on Jupiter.
  if (tradingMode(config) === "wallet") providerHosts.push(new URL(config.SOLANA_RPC_URL).hostname, "api.jup.ag");
  const http: HttpClient = test
    ? new ScriptedHttp([])
    : createFetchClient({
        allow: [...config.EGRESS_ALLOW, ...providerHosts],
        log: log.child({ port: "http" }),
        clock,
      });

  const url = config.DATABASE_URL;
  const database = url
    ? createDatabase(url, {
        pooled: /:6543\b/.test(url) || /pgbouncer=true/.test(url),
        application: options.application ?? "hunch-web",
      })
    : undefined;
  if (!database && live) missing.push("database");

  // Identity: Supabase when configured; the dev identity only off-production.
  const providers: IdentityProvider[] = [];
  if (supabaseConfigured(config))
    providers.push(
      new SupabaseIdentity(
        config.NEXT_PUBLIC_SUPABASE_URL!,
        config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      ),
    );
  let devIdentity: DevIdentity | undefined;
  if (!live) {
    devIdentity = new DevIdentity(config.SESSION_SECRET ?? DEV_SECRET, clock);
    providers.push(devIdentity);
  }
  if (!providers.length) missing.push("identity");
  const identity = providers.length
    ? new IdentityChain(providers)
    : unprovisioned<IdentityProvider>("identity");

  const wallets: WalletProvider | null = privyConfigured(config)
    ? new PrivyWallets(
        http,
        config.NEXT_PUBLIC_PRIVY_APP_ID!,
        config.PRIVY_APP_SECRET!,
      )
    : live
      ? null
      : new DevWallets();

  // Realtime: Supabase Broadcast when the project is configured and its
  // Postgres is ours — private topics are authorized by a policy in that
  // database (packages/server/drizzle/0006), so with any other database they'd never
  // arrive. Otherwise Postgres LISTEN/NOTIFY relayed over the API's SSE
  // stream. Memory in tests.
  const onSupabaseDb = (() => {
    try {
      return /\.supabase\.(co|com)$/.test(new URL(config.DIRECT_URL ?? url ?? "").hostname);
    } catch {
      return false;
    }
  })();
  let realtime: RealtimePublisher;
  let realtimeFeed: RealtimeFeed | undefined;
  let realtimeTransport: RealtimeTransport = { kind: "none" };
  const sse: RealtimeTransport = { kind: "sse", url: "/api/v1/stream" };
  if (test) {
    const memory = new MemoryRealtime();
    realtime = memory;
    realtimeFeed = memory;
    realtimeTransport = sse;
  } else if (supabaseConfigured(config) && config.SUPABASE_SECRET_KEY && onSupabaseDb) {
    realtime = new SupabaseBroadcast(
      http,
      config.NEXT_PUBLIC_SUPABASE_URL!,
      config.SUPABASE_SECRET_KEY,
    );
    realtimeTransport = {
      kind: "supabase",
      url: config.NEXT_PUBLIC_SUPABASE_URL!,
      key: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    };
  } else if (url) {
    // LISTEN holds a session: use the direct URL, never the pooler.
    const direct = config.DIRECT_URL ?? url;
    if (/:6543\b/.test(direct) || /pgbouncer=true/.test(direct))
      log.warn("realtime needs DIRECT_URL (a session connection) to listen");
    const pg = new PgRealtime(direct, log.child({ port: "realtime" }));
    realtime = pg;
    realtimeFeed = pg;
    realtimeTransport = sse;
  } else {
    realtime = pick("realtime", () => new MemoryRealtime());
  }

  const errors: ErrorReporter = config.SENTRY_DSN
    ? new SentryReporter(http, config.SENTRY_DSN, clock, log.child({ port: "errors" }), {
        environment: profile,
        release: env.VERCEL_GIT_COMMIT_SHA ?? env.RELEASE,
        serverName: options.application,
      })
    : new LogReporter();
  const analytics: Analytics = config.NEXT_PUBLIC_POSTHOG_KEY
    ? new PostHogAnalytics(http, config.NEXT_PUBLIC_POSTHOG_KEY, config.NEXT_PUBLIC_POSTHOG_HOST, clock, log.child({ port: "analytics" }))
    : new MemoryAnalytics();

  const manifests = VENUE_CATALOG.map((entry) => entry.manifest);
  const sources = new Map<DataSourceId, MarketDataSource>();
  let fixtureControl: FixtureVenue["control"] | undefined;
  if (!live) {
    const venue = createFixtureVenue(undefined, () => clock.now());
    sources.set(fixture.id, venue.source);
    fixtureControl = venue.control;
  }
  const adapterContext = (source: string): AdapterContext => ({
    http,
    rateLimiter,
    secrets: test ? memorySecrets() : envSecrets(env),
    log: log.child({ source }),
    clock,
    config: {},
  });
  // Budgets are shared across instances in real deployments: Upstash when
  // configured, else Postgres. One process (demo, tests) keeps them in memory.
  const budgets = scaleApiBudgets(RATE_BUDGETS, config.API_RATE_SCALE);
  const rateLimiter: RateLimiter = upstash
    ? new UpstashRateLimiter(http, upstash.url, upstash.token, budgets, clock)
    : live && database
      ? new PgRateLimiter(database.db, budgets, clock)
      : new TokenBucketLimiter(budgets, clock);
  const wanted =
    config.DATA_SOURCES ??
    (live
      ? ["kalshi-direct", "polymarket-public", "jupiter-predict"]
      : test
        ? []
        : ["demo-design"]);
  for (const id of wanted) {
    if (id === "demo-design" && !live)
      sources.set(id, designSource.create(adapterContext(id)));
    else if (id === "kalshi-demo")
      sources.set(id, createKalshiSource(adapterContext(id), { env: "demo" }));
    else if (id === "kalshi-direct")
      sources.set(
        id,
        createKalshiSource(adapterContext(id), { env: config.KALSHI_ENV }),
      );
    else if (id === "polymarket-public")
      sources.set(id, createPolymarketSource(adapterContext(id)));
    else if (id === "jupiter-predict")
      sources.set(id, createJupiterSource(adapterContext(id)));
    else if (!sources.has(id))
      log.warn("unknown data source ignored", { source: id });
  }
  // Wallet trading rides on the venue's data source being enabled.
  const execution = new Map<VenueId, { module: ExecutionModule; venue: ExecutionVenue }>();
  for (const trader of EXECUTION_MODULES)
    if (trader.venues.some((v) => [...sources.keys()].some((id) => SERVED.get(id)?.includes(v))))
      for (const v of trader.venues)
        execution.set(v, { module: trader, venue: trader.create(adapterContext(trader.id)) });
  // Tests always have the design dataset available to read from.
  if (test && !sources.has("demo-design"))
    sources.set(
      "demo-design",
      designSource.create(adapterContext("demo-design")),
    );

  return {
    profile,
    config,
    clock,
    log,
    http,
    rateLimiter,
    secrets: test ? memorySecrets() : envSecrets(env),
    cache: upstash
      ? new UpstashCache(http, upstash.url, upstash.token)
      : database
        ? new PgCache(database.db, clock)
        : pick("cache", () => new MemoryCache(clock)),
    jobs: database
      ? new PgJobQueue(database.db, clock)
      : pick("jobs", () => new MemoryJobQueue(clock)),
    events: pick("events", () => new MemoryEventBus()),
    realtime,
    realtimeFeed,
    realtimeTransport,
    mailer: config.RESEND_API_KEY
      ? new ResendMailer(http, config.RESEND_API_KEY, config.EMAIL_FROM, (template, data, unsubscribe) =>
          renderMail(template, data, config.APP_URL, unsubscribe),
        )
      : pick("mailer", () => new MemoryMailer()),
    // Supabase Storage when configured; local disk for the demo; memory in tests.
    storage:
      supabaseConfigured(config) && config.SUPABASE_SECRET_KEY
        ? new SupabaseStorage(http, config.NEXT_PUBLIC_SUPABASE_URL!, config.SUPABASE_SECRET_KEY, config.SUPABASE_STORAGE_BUCKET)
        : profile === "demo"
          ? new LocalDiskStorage(config.LOCAL_STORAGE_DIR, config.SESSION_SECRET ?? DEV_SECRET, clock)
          : pick("storage", () => new MemoryStorage(clock)),
    // The private beta's gate is on by default wherever it's real.
    flags: database
      ? new PgFlags(database.db, clock, { [BETA_GATE]: live })
      : pick("flags", () => new MemoryFlags({ [BETA_GATE]: live })),
    database,
    identity,
    google:
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? new GoogleOAuth(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
        : undefined,
    devIdentity,
    wallets,
    chain: tradingMode(config) === "wallet" && !test ? new SolanaRpc(http, config.SOLANA_RPC_URL, rateLimiter) : null,
    venues: {
      manifests: live ? manifests : [...manifests, fixture],
      sources,
      feeds: [
        ...new Set([
          ...wanted.filter((id) => id !== "demo-design" && sources.has(id)),
          ...(test ? [fixture.id] : []),
        ]),
      ],
      fixture: fixtureControl,
      execution,
      served: SERVED,
    },
    errors,
    analytics,
    unprovisioned: missing,
    async close() {
      await Promise.allSettled([errors.flush(), analytics.flush()]);
      await Promise.all([
        database?.close(),
        realtime instanceof PgRealtime ? realtime.close() : undefined,
      ]);
    },
  };
}
