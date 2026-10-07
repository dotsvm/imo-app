/**
 * The Postgres connection. Postgres itself is the database port: any Postgres
 * host (Supabase, Neon, RDS, a local install) is a connection string away.
 */
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Queryable = Db | Tx;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  max?: number;
  /** Behind a transaction pooler (Supabase :6543) prepared statements can't
      be held across transactions. */
  pooled?: boolean;
  application?: string;
}

export function createDatabase(
  url: string,
  options: DatabaseOptions = {},
): Database {
  const sql = postgres(url, {
    max: options.max ?? 10,
    prepare: !options.pooled,
    // Close idle connections and give up on unreachable hosts, so a pool
    // never queries over a socket that died (network change, sleep, failover).
    idle_timeout: 20,
    connect_timeout: 30,
    onnotice: () => {},
    connection: { application_name: options.application ?? "hunch" },
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, close: () => sql.end({ timeout: 5 }) };
}
