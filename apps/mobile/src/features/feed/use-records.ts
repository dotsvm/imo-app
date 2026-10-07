/**
 * Traders' records for a period, from the leaderboard: P&L, how often
 * they've been right, and how many calls have resolved. One request feeds
 * the post meta, the ticker and the Traders tab.
 */
import { useQuery } from "@tanstack/react-query";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";

export type Period = "7D" | "30D" | "90D" | "All";
export type Sort = "pnl" | "roi" | "right";

export function useLeaderboard(period: Period = "30D", sort: Sort = "pnl", limit = 100) {
  return useQuery({
    queryKey: ["leaderboard", period, sort, limit],
    queryFn: ({ signal }) => api<LeaderboardDTO>("/leaderboard", { query: { period, sort, sample: "off", limit }, signal }),
    staleTime: 60_000,
  });
}

export type Record = LeaderboardDTO["items"][number]["stats"];

/** Each trader's 30-day record by id, and the sample under which "% right" says little. */
export function useRecords() {
  const board = useLeaderboard("30D", "pnl", 100);
  const byId = new Map((board.data?.items ?? []).map((r) => [r.trader.id, r.stats]));
  return { byId, minSample: board.data?.minSample ?? 10 };
}

/** "55% right · 421 resolved", or "4 resolved · low sample" under the minimum. */
export function recordLine(stats: Record | undefined, minSample: number) {
  if (!stats || stats.resolved === 0) return null;
  if (stats.resolved < minSample) return `${stats.resolved} resolved · low sample`;
  return `${Math.round((stats.correct / stats.resolved) * 100)}% right · ${stats.resolved.toLocaleString("en-US")} resolved`;
}
