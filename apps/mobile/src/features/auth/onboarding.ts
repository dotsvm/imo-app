/** Onboarding's writes: interests, follows, and finishing. */
import type { QueryClient } from "@tanstack/react-query";
import type { MeDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";

export type Interest = MeDTO["settings"]["interests"][number];

/** The API's categories, as people know them. Order is the chips' order. */
export const INTERESTS: readonly { id: Interest; label: string }[] = [
  { id: "Politics", label: "Politics" },
  { id: "Economics", label: "Economy" },
  { id: "Sports", label: "Sports" },
  { id: "Crypto", label: "Crypto" },
  { id: "Tech", label: "Tech" },
  { id: "Culture", label: "Culture" },
  { id: "Climate", label: "Climate" },
  { id: "Science", label: "Science" },
];

export const saveInterests = (interests: Interest[]) => api("/me", { method: "PATCH", body: { interests } });

export const setFollowing = (handle: string, follow: boolean) =>
  api(`/traders/${encodeURIComponent(handle)}/follow`, { method: follow ? "PUT" : "DELETE" });

/** Done: /me says onboarded, and the root layout takes them in. */
export async function finishOnboarding(queryClient: QueryClient) {
  await api("/me", { method: "PATCH", body: { onboarded: true } });
  await queryClient.invalidateQueries({ queryKey: ["me"] });
}
