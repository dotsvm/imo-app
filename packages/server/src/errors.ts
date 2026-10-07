/** Errors use cases throw on purpose. The API layer turns them into
    responses; anything else becomes a logged 500 with a request id. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (message = "Sign in to continue.") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You can't do that.") =>
  new ApiError(403, "forbidden", message);
export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} was not found.`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
export const invalid = (message: string, details?: unknown) =>
  new ApiError(422, "invalid", message, details);
export const rateLimited = (
  message = "Too many requests. Try again in a moment.",
) => new ApiError(429, "rate_limited", message);
export const unavailable = (message: string) =>
  new ApiError(503, "unavailable", message);
