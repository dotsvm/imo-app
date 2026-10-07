/**
 * One wrapper for every API route. Each endpoint declares its contract —
 * auth, params, query, body, rate budget — and gets, for free:
 *
 * - a request id (echoed in `x-request-id`, and on every log line);
 * - the signed-in viewer, provisioned on first sign-in;
 * - zod-validated input (400 with the issues when it doesn't parse);
 * - per-person rate limits (per IP when signed out);
 * - idempotent replays for POSTs sent with an `Idempotency-Key`;
 * - uniform errors: `{ error: { code, message, details } }`, never a stack.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { BETA_GATE } from "../composition";
import type { RequestCredentials } from "@imo/core/ports/identity";
import { HttpError } from "@imo/core/ports/runtime";
import { ApiError, forbidden, rateLimited, unauthorized, unavailable } from "../errors";
import { idempotencyKeys } from "../db/schema";
import { getServerDeps, ready, type ServerDeps } from "../deps";
import { viewerFor, type Viewer } from "../usecases/viewer";

type Auth = "required" | "optional" | "none";
type ViewerFor<A extends Auth> = A extends "required" ? Viewer : Viewer | null;

export interface HandlerContext<A extends Auth, P, Q, B> {
  request: NextRequest;
  deps: ServerDeps;
  viewer: ViewerFor<A>;
  params: P;
  query: Q;
  body: B;
  requestId: string;
  /** The request's credentials, for identity calls (sign-in, sign-out). */
  credentials: RequestCredentials;
  /** Set a cookie on the response (sessions). */
  setCookie(
    name: string,
    value: string,
    options?: Parameters<NextResponse["cookies"]["set"]>[2],
  ): void;
}

export interface RouteSpec<A extends Auth, P, Q, B> {
  auth: A;
  params?: ZodType<P>;
  query?: ZodType<Q>;
  body?: ZodType<B>;
  /** Rate budget: "api:read", "api:write", "api:order", "api:auth". */
  limit?: string;
  /** Status for a successful response; 200 by default. */
  status?: number;
  /** Writes closed to people without beta access while the gate is on
      (reads stay open). True by default; routes someone needs to get in
      say false. */
  gate?: boolean;
  /** Only for this role (admin routes). */
  role?: "admin";
  handler(context: HandlerContext<A, P, Q, B>): Promise<unknown>;
}

type RouteArgs = { params: Promise<Record<string, string | string[]>> };

const clientIp = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "local";

function errorResponse(error: ApiError, requestId: string) {
  const response = NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
      },
    },
    {
      status: error.status,
      headers: { "x-request-id": requestId, "cache-control": "no-store" },
    },
  );
  // Budgets refill within a second or two: say when to come back.
  if (error.status === 429) response.headers.set("retry-after", "1");
  return response;
}

/** The reasons under an error, outermost first: "getaddrinfo ENOTFOUND …". */
function causeOf(error: unknown): string | undefined {
  const reasons: string[] = [];
  let at = error instanceof Error ? error.cause : undefined;
  while (at && reasons.length < 3) {
    const code = (at as { code?: unknown }).code;
    reasons.push(`${typeof code === "string" ? `${code}: ` : ""}${at instanceof Error ? at.message : String(at)}`);
    at = at instanceof Error ? at.cause : undefined;
  }
  return reasons.length ? reasons.join(" ← ") : undefined;
}

/**
 * Cookies ride along on cross-site requests; bearer tokens don't. A write
 * carrying only a cookie must come from our own pages: browsers always send
 * Origin on cross-site writes, so one naming another site is refused.
 */
function refuseCrossSite(request: NextRequest, appUrl: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("authorization")) return;
  const from = request.headers.get("origin");
  if (!from || from === "null") return;
  let host: string;
  try {
    host = new URL(from).host;
  } catch {
    throw forbidden("Cross-site request refused.");
  }
  const own = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host !== new URL(appUrl).host && host !== own) throw forbidden("Cross-site request refused.");
}

export function route<
  A extends Auth,
  P = Record<string, never>,
  Q = Record<string, never>,
  B = undefined,
>(spec: RouteSpec<A, P, Q, B>) {
  const handle = async function handle(
    request: NextRequest,
    args: RouteArgs,
  ): Promise<Response> {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    const cookies: {
      name: string;
      value: string;
      options?: Parameters<NextResponse["cookies"]["set"]>[2];
    }[] = [];
    // A refreshed session rides on every answer, errors included: the old
    // refresh token is spent, so dropping the new one would sign them out.
    const withCookies = (response: Response) => {
      if (response instanceof NextResponse)
        for (const cookie of cookies)
          response.cookies.set(cookie.name, cookie.value, cookie.options);
      return response;
    };
    let deps: ServerDeps | undefined;
    let viewerId: string | undefined;
    try {
      deps = getServerDeps();
      await ready();
      refuseCrossSite(request, deps.config.APP_URL);
      const credentials: RequestCredentials = {
        headers: request.headers,
        cookie: (name) => request.cookies.get(name)?.value,
        setCookie: (name, value, options) =>
          cookies.push({ name, value, options }),
      };

      let viewer: Viewer | null = null;
      if (spec.auth !== "none") {
        const identity = await deps.identity.resolve(credentials);
        if (identity) viewer = await viewerFor(deps, identity);
        viewerId = viewer?.userId;
        if (!viewer && spec.auth === "required") throw unauthorized();
        if (viewer?.status === "suspended")
          throw forbidden("This account is suspended.");
      }

      if (spec.role && viewer?.role !== spec.role)
        throw viewer ? forbidden("That's for admins.") : unauthorized();

      // The private beta is open to read (the feed, markets, people, rooms —
      // what a signed-out visitor sees) and invite-only to take part: the
      // gate stands in front of writes.
      const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (writes && spec.gate !== false && (await deps.flags.enabled(BETA_GATE))) {
        if (!viewer) throw unauthorized();
        if (!viewer.accessGranted)
          throw new ApiError(
            403,
            "beta_access_required",
            "imo is invite-only for now. Enter an invite code, or join the waitlist.",
          );
      }

      if (spec.limit) {
        const who = viewer?.userId ?? clientIp(request);
        if (!(await deps.rateLimiter.tryAcquire(`${spec.limit}:${who}`)))
          throw rateLimited();
      }

      const rawParams = await args.params;
      const params = (
        spec.params ? spec.params.parse(rawParams) : rawParams
      ) as P;
      const query = (
        spec.query
          ? spec.query.parse(Object.fromEntries(request.nextUrl.searchParams))
          : {}
      ) as Q;
      let body = undefined as B;
      if (spec.body) {
        // An empty body is `undefined`, for bodies whose fields all default.
        const text = await request.text();
        let raw: unknown;
        try {
          raw = text.trim() ? JSON.parse(text) : undefined;
        } catch {
          throw new ApiError(400, "bad_request", "The request body must be JSON.");
        }
        body = spec.body.parse(raw);
      }

      const idempotencyKey =
        request.method === "POST"
          ? request.headers.get("idempotency-key")
          : null;
      if (idempotencyKey && viewer) {
        const [seen] = await deps.db
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, viewer.userId),
              eq(idempotencyKeys.key, idempotencyKey),
            ),
          )
          .limit(1);
        if (seen)
          return withCookies(
            NextResponse.json(seen.response, {
              status: seen.status,
              headers: { "x-request-id": requestId, "idempotent-replay": "true" },
            }),
          );
      }

      const result = await spec.handler({
        request,
        deps,
        viewer: viewer as ViewerFor<A>,
        params,
        query,
        body,
        requestId,
        credentials,
        setCookie: (name, value, options) =>
          cookies.push({ name, value, options }),
      });

      const response =
        result instanceof Response
          ? result
          : NextResponse.json(result ?? null, {
              status: spec.status ?? 200,
              headers: {
                "x-request-id": requestId,
                "cache-control": "no-store",
              },
            });
      if (idempotencyKey && viewer && !(result instanceof Response))
        await deps.db
          .insert(idempotencyKeys)
          .values({
            userId: viewer.userId,
            key: idempotencyKey,
            route: request.nextUrl.pathname,
            status: spec.status ?? 200,
            response: result ?? null,
          })
          .onConflictDoNothing();
      return withCookies(response);
    } catch (error) {
      if (error instanceof ApiError)
        return withCookies(errorResponse(error, requestId));
      if (error instanceof z.ZodError)
        return withCookies(
          errorResponse(
            new ApiError(
              400,
              "bad_request",
              "Some fields are invalid.",
              z.flattenError(error),
            ),
            requestId,
          ),
        );
      // A venue or provider that didn't answer: unavailable for now, not a
      // fault of ours — logged, but kept out of error reports.
      if (upstreamFailure(error)) {
        deps?.log.warn("upstream unavailable", {
          requestId,
          path: request.nextUrl.pathname,
          error: error instanceof Error ? error.message : String(error),
        });
        return withCookies(
          errorResponse(unavailable("The venue isn’t answering right now. Try again in a moment."), requestId),
        );
      }
      deps?.log.error("request failed", {
        requestId,
        method: request.method,
        path: request.nextUrl.pathname,
        error: error instanceof Error ? error.message : String(error),
        // The query library's "Failed query: …" wraps the database's own
        // reason (a refused connection, a missing table…): say it too.
        cause: causeOf(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!deps) console.error(error);
      deps?.errors.capture(error, {
        requestId,
        userId: viewerId,
        tags: { method: request.method, path: request.nextUrl.pathname },
      });
      return withCookies(
        errorResponse(
          new ApiError(500, "internal", "Something went wrong on our side."),
          requestId,
        ),
      );
    }
  };
  // The contract, for the OpenAPI document (packages/server/scripts/openapi.ts).
  return Object.assign(handle, { spec: spec as RouteSpec<Auth, unknown, unknown, unknown> });
}

/** A call to a venue or provider that failed on their side or on the way:
    an HTTP error from them, a circuit paused after repeated failures, a
    timeout, or a network error. */
function upstreamFailure(error: unknown) {
  if (error instanceof HttpError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === "CircuitOpen" ||
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    (error instanceof TypeError && /fetch failed/i.test(error.message))
  );
}
