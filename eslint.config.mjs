import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const VENUE_NAMES = "/kalshi|polymarket/i";
const noVenueLiterals = [
  {
    selector: `Literal[value=${VENUE_NAMES}]`,
    message:
      "Venues are data: read names and behavior from the registry (@/data/venues), never literals.",
  },
  {
    selector: `TemplateElement[value.raw=${VENUE_NAMES}]`,
    message:
      "Venues are data: read names and behavior from the registry (@/data/venues), never literals.",
  },
];

/**
 * Where each layer may reach. Package boundaries do most of the work (core
 * depends on nothing; venues only on core); these rules keep the layers
 * inside the server package and the web app honest too.
 */
const boundaries = {
  core: {
    patterns: [
      {
        group: ["@imo/*", "@imo/**", "react", "next", "next/**"],
        message: "The core is vendor- and framework-free: it depends on nothing but itself.",
      },
    ],
  },
  venues: {
    patterns: [
      {
        group: ["@imo/server", "@imo/server/**", "@imo/domain", "@imo/domain/**", "react", "next", "next/**"],
        message: "Venue modules depend on the core and the venue SDK only.",
      },
    ],
  },
  ui: {
    patterns: [
      {
        group: ["@imo/venues/*/**", "!@imo/venues/catalog", "!@imo/venues/sdk/**", "@imo/server/adapters/**", "@imo/server/composition", "@imo/server/composition/**", "@imo/server/usecases/**", "@imo/server/db/**"],
        message: "Screens reach venues and providers through the API and @/data, never directly.",
      },
    ],
  },
  api: {
    patterns: [
      {
        group: ["@imo/server/adapters/**", "@imo/server/composition", "@imo/server/composition/**", "@imo/venues/*/**", "@/features/**", "@/components/**"],
        message: "Route handlers call use cases through @imo/server only.",
      },
    ],
  },
  server: {
    patterns: [
      {
        group: ["../adapters/**", "../../adapters/**", "../../../adapters/**", "@imo/venues/*/source*", "!@imo/venues/sdk/**"],
        message: "Use cases depend on ports; only the composition root wires adapters.",
      },
    ],
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", boundaries.core],
      "no-restricted-syntax": ["error", ...noVenueLiterals],
    },
  },
  {
    files: ["packages/venues/src/**/*.ts"],
    rules: { "no-restricted-imports": ["error", boundaries.venues] },
  },
  {
    files: ["apps/web/src/{app,features,components,data}/**/*.{ts,tsx}", "packages/domain/src/**/*.ts"],
    // The demo dataset names real venues on purpose: it is sample data.
    ignores: ["apps/web/src/app/api/**", "packages/domain/src/demo/**"],
    rules: {
      "no-restricted-imports": ["error", boundaries.ui],
      "no-restricted-syntax": ["error", ...noVenueLiterals],
    },
  },
  {
    // Route handlers are the HTTP edge of the server: they call use cases
    // through @imo/server, never adapters or venue modules directly.
    files: ["apps/web/src/app/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", boundaries.api],
      "no-restricted-syntax": ["error", ...noVenueLiterals],
    },
  },
  {
    files: ["packages/server/src/{usecases,http,dto,db}/**/*.ts"],
    rules: { "no-restricted-imports": ["error", boundaries.server] },
  },
  {
    // The waitlist app: its screens follow the web app's rules; claims.ts is
    // its client module, and its API routes re-export the web app's handlers.
    // A holder link's server side (lookup and preview images) is a route too.
    files: ["apps/waitlist/app/**/*.{ts,tsx}"],
    ignores: [
      "apps/waitlist/app/api/**",
      "apps/waitlist/app/claims.ts",
      "apps/waitlist/app/i/**/{holder,card-image,opengraph-image,twitter-image}.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", boundaries.ui],
      "no-restricted-syntax": ["error", ...noVenueLiterals],
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "**/.turbo/**",
    "**/next-env.d.ts",
    // The Expo app lints and typechecks itself (`npm --prefix apps/mobile run lint`).
    "apps/mobile/**",
    "**/test-results/**",
    "**/playwright-report/**",
  ]),
]);
