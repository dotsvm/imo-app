/** Readiness: the database answers and every port is provisioned. Reports
    port names only, never configuration values. */
import { sql } from "drizzle-orm";
import { getServerDeps, ready } from "@imo/server/deps";

export async function GET() {
  try {
    const deps = getServerDeps();
    await ready();
    await deps.db.execute(sql`select 1`);
    const unprovisioned = [...deps.unprovisioned];
    return Response.json(
      { ok: unprovisioned.length === 0, profile: deps.profile, unprovisioned },
      {
        status: unprovisioned.length ? 503 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message.split("\n")[0] : "unavailable",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
