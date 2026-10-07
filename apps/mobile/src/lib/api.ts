/**
 * The app's way to imo's API (/api/v1): JSON both ways, the session as a
 * bearer token, and the API's `{ error: { code, message } }` turned into an
 * ApiRequestError a screen can show as-is.
 *
 * Response types come straight from the server (src/server/dto/api-types.ts),
 * so a change there shows up here as a type error, not a runtime surprise.
 */
import { getAccessToken, saveSession } from "./session";

/** Where the API lives. On a phone or the Android emulator, "localhost" is the
    device itself: point this at your machine's LAN address instead. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Server paths ("/avatars/…") become absolute; full URLs pass through. */
export const absolute = (url: string) => (url.startsWith("/") ? API_URL + url : url);

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query.set(k, String(v));
  const qs = query.size ? `?${query}` : "";

  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}${qs}`, {
      method,
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiRequestError(0, "offline", "Can't reach imo. Check your connection.");
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; message?: string } }
    | null;
  if (response.ok) return payload as T;

  // The API no longer knows this session: drop it and carry on signed out.
  if (response.status === 401 && token) await saveSession(null);
  const error = payload && "error" in payload ? payload.error : undefined;
  throw new ApiRequestError(
    response.status,
    error?.code ?? "http_error",
    error?.message ?? "Something went wrong. Try again.",
  );
}
