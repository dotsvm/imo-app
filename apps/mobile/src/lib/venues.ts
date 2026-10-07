/**
 * Venues come from the API's catalog, never from the app: a new venue shows
 * up here with its own name and color, and no screen changes.
 */
import { useQuery } from "@tanstack/react-query";
import type { listVenues } from "@imo/server/usecases/venues";
import { api } from "./api";

type VenuesDTO = Awaited<ReturnType<typeof listVenues>>;

export function useVenues() {
  const { data } = useQuery({
    queryKey: ["venues"],
    queryFn: ({ signal }) => api<VenuesDTO>("/venues", { signal }),
    staleTime: 60 * 60 * 1000,
  });
  return new Map((data?.items ?? []).map((v) => [v.id, v.display]));
}
