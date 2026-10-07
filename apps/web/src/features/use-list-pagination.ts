"use client";

import { useState } from "react";

const PAGE_SIZE = 20;

export function useListPagination<T>(items: T[], filterKey: string) {
  const [page, setPage] = useState({ filterKey, limit: PAGE_SIZE });
  // Reset for filter changes, including browser back/forward navigation.
  if (page.filterKey !== filterKey) {
    setPage({ filterKey, limit: PAGE_SIZE });
  }
  const limit = page.filterKey === filterKey ? page.limit : PAGE_SIZE;
  return {
    visible: items.slice(0, limit),
    loadMore: () =>
      setPage((current) => ({
        filterKey,
        limit: Math.min(current.limit + PAGE_SIZE, items.length),
      })),
  };
}
