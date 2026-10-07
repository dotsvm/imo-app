/**
 * Column conventions shared by every table:
 * - Ids are UUIDs.
 * - Timestamps are timestamptz.
 * - Money and quantities are bigint minor units, beside the currency or scale
 *   that gives them meaning (see packages/core/src/money.ts).
 *
 * The client runs with `casing: "snake_case"`, so keys are camelCase in
 * TypeScript and snake_case in Postgres.
 */
import { sql } from "drizzle-orm";
import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid().primaryKey().defaultRandom();
export const ref = () => uuid();
export const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const when = () => timestamp({ withTimezone: true });
/** Integer minor units (or share units): exact in a JS number up to 2^53. */
export const units = () => bigint({ mode: "number" });

/** A CHECK that a text column holds one of `values`. */
export const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);
