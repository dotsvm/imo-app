/**
 * The prediction being written, shared by the composer and the market
 * picker it opens. Lives until it's published or cancelled.
 */
import { useSyncExternalStore } from "react";
import type { MarketDTO } from "@imo/server/dto/api-types";

export type Confidence = "Low" | "Medium" | "High";

export interface Draft {
  market: MarketDTO | null;
  outcome: "Yes" | "No";
  text: string;
  confidence: Confidence;
}

const EMPTY: Draft = { market: null, outcome: "Yes", text: "", confidence: "Medium" };
let draft: Draft = EMPTY;
const listeners = new Set<() => void>();

export function updateDraft(patch: Partial<Draft>) {
  draft = { ...draft, ...patch };
  listeners.forEach((fn) => fn());
}

export const clearDraft = () => updateDraft(EMPTY);

export function useDraft() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => draft,
  );
}
