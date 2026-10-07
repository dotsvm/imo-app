/**
 * The waitlist app's calls to its API (the main app's handlers, re-exported
 * under app/api): where you stand, whether a handle is free, claiming one,
 * the line's counts, and signing in — all through our own server.
 */
import type { HandleAvailabilityDTO, WaitlistConfigDTO, WaitlistSizeDTO, WaitlistStatusDTO } from "@imo/server/dto/api-types";
import { api } from "@web/client/http";

export type WaitlistStatus = WaitlistStatusDTO;
export type WaitlistConfig = WaitlistConfigDTO;

/** What the page needs to show its card: the sign-in options, and where you
    stand (`status` is null when you're signed out). Signed out is an answer,
    not an error: `failed` means the line couldn't be read at all. */
export async function openWaitlist() {
  const [config, me] = await Promise.allSettled([
    api<WaitlistConfigDTO>("waitlist/config"),
    api<WaitlistStatusDTO | null>("waitlist/me"),
  ]);
  return {
    config: config.status === "fulfilled" ? config.value : null,
    status: me.status === "fulfilled" ? me.value : null,
    failed: me.status === "rejected",
  };
}

export type WaitlistCounts = WaitlistSizeDTO;

/** How many are waiting and how many founding passes are left; null when
    they can't be had (the page then just doesn't show them). */
export const waitlistCounts = () => api<WaitlistSizeDTO>("waitlist").catch(() => null);

export const checkHandle = (handle: string, signal?: AbortSignal) =>
  api<HandleAvailabilityDTO>(`handles/${encodeURIComponent(handle)}`, { signal });

/** Hold a handle, on the edition you picked — and say whose link sent you. */
export const claimHandle = (handle: string, extra: { edition?: string; ref?: string } = {}) =>
  api<WaitlistStatusDTO>("waitlist/claim", { body: { handle, ...extra } });

/** You shared your pass: the server moves you up the line, once. */
export const shareWaitlist = () => api<WaitlistStatusDTO>("waitlist/share", { method: "POST" });

/** Someone opened a holder's link: counted once per browser. */
export const countOpen = (handle: string) =>
  api("waitlist/opens", { body: { handle } }).catch(() => {});

/** Google or X: the browser goes to our server, which sends it on to the
    provider's page (no provider address or key in the page). */
export const signInUrl = (way: "google" | "x", next: string) =>
  `/api/v1/auth/start?with=${way}&next=${encodeURIComponent(next)}`;

/** An emailed sign-in link, sent by our server. */
export const sendSignInLink = (email: string, next: string) =>
  api<{ sent: boolean }>("auth/email", { body: { email, next } });

export const devSignIn = (subject: string, email: string, name: string) =>
  api("dev/session", { body: { subject, email, name } });

export const signOutHere = () => api("auth/sign-out", { method: "POST" }).catch(() => {});
