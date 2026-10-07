import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildOpenApi, pathOf, routeFiles } from "@imo/server/http/openapi";

process.env.APP_PROFILE ??= "test";
const app = join(process.cwd(), "src/app");

test("paths come from the folders, with dynamic segments as parameters", () => {
  assert.equal(pathOf(app, join(app, "api/v1/markets/[slug]/book/route.ts")), "/api/v1/markets/{slug}/book");
  assert.equal(pathOf(app, join(app, "api/v1/uploads/[...key]/route.ts")), "/api/v1/uploads/{key}");
});

test("every API handler is described, and every operation is unique", async () => {
  const doc = await buildOpenApi(app, (file) => import(file));
  // Plain health checks don't go through route(); nothing else may.
  const outside = new Set(["/api/health", "/api/ready"]);
  for (const file of routeFiles(join(app, "api"))) {
    const path = pathOf(app, file);
    const handlers = (await import(file)) as Record<string, unknown>;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
      if (handlers[method] && !outside.has(path))
        assert.ok((doc.paths[path] as Record<string, unknown> | undefined)?.[method.toLowerCase()], `${method} ${path} is missing`);
  }
  const ids = Object.values(doc.paths).flatMap((ops) => Object.values(ops as Record<string, { operationId: string }>).map((o) => o.operationId));
  assert.equal(new Set(ids).size, ids.length, "operation ids are unique");
  const place = (doc.paths["/api/v1/orders"] as Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>).post;
  assert.ok(place.requestBody, "bodies are described");
  assert.ok(place.responses["201"], "with the status the route really answers");
});
