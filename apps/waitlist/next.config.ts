/**
 * The waitlist app. It lives beside the main app in this repository and
 * shares its code (apps/web and packages/) — the same database, sign-in and waitlist rules —
 * so its API routes re-export the main app's handlers rather than copy them.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

/** The repository root: shared code, packages and, locally, .env files. */
const root = resolve(__dirname, "../..");
// Locally, one .env.local serves both apps. Next has already read this app's
// own .env files (APP_URL and the like), and those win; the root's fill in
// the rest. Deployed, the host sets every variable and there are no files.
for (const file of [".env.local", ".env"]) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const pair = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (pair && !(pair[1] in process.env)) process.env[pair[1]] = pair[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const origin = (url?: string) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};
const isDev = process.env.NODE_ENV === "development";
const https = (process.env.APP_URL ?? "").startsWith("https://");
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Uploaded avatars live in Supabase storage; X and Google sign-ins bring a photo.
  `img-src 'self' blob: data: ${supabase} https://lh3.googleusercontent.com https://pbs.twimg.com`,
  "font-src 'self' data:",
  // Sign-in runs through our own server: the page talks to nothing else.
  "connect-src 'self'",
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
  // The repository's AGENTS.md covers this app too.
  agentRules: false,
  poweredByHeader: false,
  // Shared code sits outside this folder: build and trace from the root.
  turbopack: { root },
  outputFileTracingRoot: root,
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
