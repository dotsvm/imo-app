import { redirect } from "next/navigation";
import { safeNext } from "@imo/core/paths";

/**
 * Signing in is a dialog over the app, not a page. Links made for the old
 * welcome screen (emails, bookmarks) land where they were headed with the
 * dialog open — an invite's code and a sign-in problem carried along.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const to = typeof params.next === "string" ? safeNext(params.next, "/") : "/";
  const carry = new URLSearchParams({ login: "1" });
  for (const key of ["invite", "signin"]) {
    const value = params[key];
    if (typeof value === "string") carry.set(key, value);
  }
  redirect(`${to}${to.includes("?") ? "&" : "?"}${carry}`);
}
