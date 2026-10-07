/** Call route handlers directly, as a signed-in dev user. */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as devSession } from "../../src/app/api/v1/dev/session/route";

type Handler = (request: NextRequest, args: { params: Promise<Record<string, string>> }) => Promise<Response>;

let ip = 0;
export async function signIn(subject: string, name = "Test Trader", email?: string) {
  const res = await devSession(
    new NextRequest("http://localhost/api/v1/dev/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.200.${ip++ % 250}.1` },
      body: JSON.stringify({ subject, name, ...(email && { email }) }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(res.status, 200);
  return `Bearer ${((await res.json()) as { token: string }).token}`;
}

export async function call<T = Record<string, unknown>>(
  handler: Handler,
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string>; auth?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "x-forwarded-for": "10.9.0.1" };
  if (options.auth) headers.authorization = options.auth;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const res = await handler(
    new NextRequest(`http://localhost${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  return { status: res.status, body: (await res.json()) as T };
}
