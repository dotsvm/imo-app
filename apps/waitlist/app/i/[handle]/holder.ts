/**
 * The server side of a holder's link (/i/[handle]): whose pass it is, for
 * the page's metadata and its preview image. Like a route handler, it calls
 * the use case directly; the page's screens still go through the API.
 */
import { cache } from "react";
import { routeParam } from "@imo/core/paths";
import { getServerDeps } from "@imo/server/deps";
import { passCard } from "@imo/server/usecases/waitlist";

/** The holder behind a link, or null — no such holder, or no database. */
export const holderOf = cache(async (param: string) => {
  try {
    return await passCard(getServerDeps().db, routeParam(param).replace(/^@/, ""));
  } catch {
    return null;
  }
});

/** Where the waitlist lives, as people read it: "imo.live". */
export const waitlistHost = () => {
  try {
    return new URL(process.env.APP_URL ?? "").host || "imo.live";
  } catch {
    return "imo.live";
  }
};
