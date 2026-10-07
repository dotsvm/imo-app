/**
 * Where to go after signing in: one of our own pages, named by path. Anything
 * else — another origin ("//evil.example", "/\evil.example"), a scheme, the
 * API — falls back, so a crafted link can't send someone off-site.
 */
export function safeNext(value: string | null | undefined, fallback = "/") {
  if (!value || value.length > 2_000) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return fallback;
  if (/[\\\u0000-\u001f\u007f\s]/.test(value)) return fallback;
  return value;
}

/** Our sign-in callback on `origin`, going on to `next` (one of our pages). */
export const signInReturn = (origin: string, next: string) =>
  `${origin}/api/v1/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

/** `path` with one query parameter set, keeping the rest. */
export function withParam(path: string, name: string, value: string) {
  const url = new URL(path, "http://local");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A dynamic route segment as the app named it: Next hands it over still
    percent-encoded ("fed-dec%3Ayes" for a position "fed-dec:yes"). */
export function routeParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
