/**
 * "Now" for market data. The demo's markets, prices and people are a snapshot
 * taken September 25, 2026 at 14:26 UTC, so demo screens measure data time
 * from that moment. When the server serves live venue data it says so
 * (GET /api/v1/config), and data time becomes the real clock. Things you
 * write yourself (messages, list edits) always use the real clock.
 */
export const DEMO_SNAPSHOT = Date.parse("2026-09-25T14:26:00Z");

// The real clock until the server says its data is a fixed snapshot.
let snapshot: number | null = null;

/** Set by the data layer from the server's config: a fixed moment, or null
    for live data. */
export function setDataSnapshot(at: string | null) {
  snapshot = at ? Date.parse(at) : null;
}

/** The moment the market data on screen describes, in epoch milliseconds. */
export const dataNow = (): number => snapshot ?? Date.now();
