/**
 * A feed, page by page. Posts name their market by slug only, so each page
 * fetches its markets alongside it: a card never renders without its odds.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import type { FeedPage, MarketDTO, MarketPage, PostDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";

/** The feeds the API serves (src/server/usecases/posts.ts → FEEDS). */
export type Feed = "for-you" | "latest" | "following";

export interface FeedEntry {
  post: PostDTO;
  market: MarketDTO;
}

const PAGE = 20;

async function loadPage(feed: Feed, cursor: string | undefined, signal: AbortSignal) {
  const page = await api<FeedPage>("/posts", { query: { feed, cursor, limit: PAGE }, signal });
  const slugs = [...new Set(page.items.map((p) => p.marketId))];
  const markets = slugs.length
    ? await api<MarketPage>("/markets", { query: { ids: slugs.join(","), limit: slugs.length }, signal })
    : { items: [] as MarketDTO[] };
  const bySlug = new Map(markets.items.map((m) => [m.id, m]));
  return {
    // A post whose market didn't come back (delisted) has nothing to trade: leave it out.
    entries: page.items.flatMap((post): FeedEntry[] => {
      const market = bySlug.get(post.marketId);
      return market ? [{ post, market }] : [];
    }),
    next: page.next,
  };
}

export function useFeed(feed: Feed) {
  return useInfiniteQuery({
    queryKey: ["feed", feed],
    queryFn: ({ pageParam, signal }) => loadPage(feed, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
  });
}
