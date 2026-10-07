/**
 * The browser's way to the API: same-origin fetches (the session rides in a
 * cookie), JSON both ways, and the API's `{ error: { code, message } }`
 * turned into an ApiRequestError the screens can show as-is.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Makes a retried POST land once. */
  idempotencyKey?: string;
}

let expired: (() => void) | undefined;
let accessRequired: (() => void) | undefined;
/** Told when a write needs beta access the account doesn't have yet. */
export const onAccessRequired = (fn: () => void) => {
  accessRequired = fn;
};
/** Told when the API stops recognizing the session (it expired, or ended in
    another tab), so the app can send them to sign in again. */
export const onSessionExpired = (fn: () => void) => {
  expired = fn;
};

/** A pause that ends early, with an AbortError, if the caller gives up. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) return abort();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        abort();
      },
      { once: true },
    );
  });

/** Reads asked to slow down try again, as told (Retry-After), a few times. */
const READ_RETRIES = 3;

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  for (let attempt = 0; ; attempt++) {
    const response = await send(path, method, options);
    if (response.status === 429 && method === "GET" && attempt < READ_RETRIES) {
      const seconds = Number(response.headers.get("retry-after")) || 1;
      await pause(seconds * 1_000 * (attempt + 1), options.signal);
      continue;
    }
    return read<T>(response);
  }
}

function send(path: string, method: string, options: RequestOptions) {
  return fetch(path.startsWith("/") ? path : `/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(options.body !== undefined && { "content-type": "application/json" }),
      ...(options.idempotencyKey && { "idempotency-key": options.idempotencyKey }),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: "no-store",
  }).catch((error: unknown) => {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiRequestError(0, "offline", "Can't reach imo right now. Check your connection.");
  });
}

async function read<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Not ours (a proxy's error page): the status says enough.
  }
  if (response.status === 401) expired?.();
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (response.status === 403 && error?.code === "beta_access_required") accessRequired?.();
    throw new ApiRequestError(
      response.status,
      error?.code ?? "error",
      error?.message ?? "Something went wrong. Try again.",
      error?.details,
    );
  }
  return payload as T;
}

export const query = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
