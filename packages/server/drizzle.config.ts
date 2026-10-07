import { defineConfig } from "drizzle-kit";

/** Migrations are plain SQL in ./drizzle, applied the same way to local
    Postgres and to Supabase (DIRECT_URL, never the pooler). */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgres://localhost:5432/hunch_dev",
  },
  migrations: { table: "__drizzle_migrations", schema: "public" },
  strict: true,
  verbose: true,
});
