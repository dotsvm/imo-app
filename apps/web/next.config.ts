import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** The monorepo root: workspace packages and, locally, the shared .env files. */
const root = path.resolve(process.cwd(), "../..");
// Locally, one .env.local at the root serves every app. Next has read this
// app's own .env files first, and those win. Deployed, the host sets them all.
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const pair = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (pair && !(pair[1] in process.env)) process.env[pair[1]] = pair[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const isDev = process.env.NODE_ENV === "development";
/** Served over HTTPS (a real deployment): upgrade stray http and pin HSTS.
    A production build on http://localhost (end-to-end tests) must do neither. */
const https = (process.env.APP_URL ?? "").startsWith("https://");
const origin = (url?: string) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const posthog = process.env.NEXT_PUBLIC_POSTHOG_KEY ? origin(process.env.NEXT_PUBLIC_POSTHOG_HOST) : "";
// PostHog serves its script from a sibling assets host (us-assets.i.posthog.com).
const posthogAssets = posthog.replace("://us.i.", "://us-assets.i.").replace("://eu.i.", "://eu-assets.i.");
/** Privy's embedded wallets and WalletConnect for external wallets. */
const wallets = [
  "https://auth.privy.io",
  "https://*.privy.io",
  "https://*.privy.systems",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
];

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${posthogAssets}`,
  "style-src 'self' 'unsafe-inline'",
  // Illustrated avatars are our own files; Google photos (older accounts), uploads in Supabase Storage.
  `img-src 'self' blob: data: ${supabase} https://lh3.googleusercontent.com https://pbs.twimg.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabase.replace(/^https:/, "wss:")} ${posthog} ${posthogAssets} ${wallets.join(" ")}`,
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(https ? ["upgrade-insecure-requests"] : []),
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  // Workspace packages live beside this app: resolve and trace from the root.
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
        ],
      },
    ];
  },
};
export default nextConfig;
