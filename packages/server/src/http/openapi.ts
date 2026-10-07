/**
 * The OpenAPI document, built from the routes themselves: every handler made
 * with `route()` carries its contract (auth, params, query, body, status,
 * rate budget, gate), and zod turns the schemas into JSON Schema. Responses
 * are the UI's own types; the document names their status codes.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z, type ZodType } from "zod";

interface Contract {
  auth: "required" | "optional" | "none";
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  status?: number;
  limit?: string;
  gate?: boolean;
  role?: string;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const jsonSchema = (schema: ZodType) =>
  z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

/** apps/web/src/app/api/v1/markets/[slug]/book/route.ts → /api/v1/markets/{slug}/book */
export const pathOf = (appDir: string, file: string) =>
  "/" +
  relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .map((part) => part.replace(/^\[\.\.\.(.+)\]$/, "{$1}").replace(/^\[(.+)\]$/, "{$1}"))
    .join("/");

export function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

const ERRORS: Record<number, string> = {
  400: "The request didn't parse (fields listed in `error.details`).",
  401: "Sign in first.",
  403: "Not allowed (or the beta is invite-only).",
  404: "Not found.",
  409: "Conflicts with the current state (a moved price, a used invite…).",
  422: "Understood but refused (a rule of the product).",
  429: "Rate limited; try again shortly.",
};

export async function buildOpenApi(appDir: string, importer: (file: string) => Promise<Record<string, unknown>>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const file of routeFiles(join(appDir, "api")).sort()) {
    const handlers = await importer(file);
    const path = pathOf(appDir, file);
    for (const method of METHODS) {
      const handler = handlers[method] as { spec?: Contract } | undefined;
      const spec = handler?.spec;
      if (!spec) continue;
      const parameters = [
        ...Object.entries(spec.params ? (jsonSchema(spec.params).properties ?? {}) : {}).map(([name, schema]) => ({
          name,
          in: "path",
          required: true,
          schema,
        })),
        ...(() => {
          if (!spec.query) return [];
          const q = jsonSchema(spec.query);
          return Object.entries(q.properties ?? {}).map(([name, schema]) => ({
            name,
            in: "query",
            required: q.required?.includes(name) ?? false,
            schema,
          }));
        })(),
      ];
      const status = spec.status ?? 200;
      const errors = [400, ...(spec.auth === "required" ? [401] : []), 403, 404, 409, 422, 429];
      paths[path] ??= {};
      paths[path][method.toLowerCase()] = {
        operationId: `${method.toLowerCase()}${path.replace(/[{}]/g, "").replace(/(^|[/-])(\w)/g, (_, __, c: string) => c.toUpperCase())}`,
        tags: [path.split("/")[3] ?? "api"],
        ...(spec.auth === "required" ? { security: [{ bearer: [] }, { session: [] }] } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(spec.body
          ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(spec.body) } } } }
          : {}),
        responses: {
          [status]: { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
          ...Object.fromEntries(errors.map((code) => [code, { $ref: "#/components/responses/Error" }])),
        },
        "x-auth": spec.auth,
        ...(spec.limit ? { "x-rate-budget": spec.limit } : {}),
        "x-beta-gate": spec.gate !== false,
        ...(spec.role ? { "x-role": spec.role } : {}),
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "imo API",
      version: "1",
      description:
        "Paper trading on live prediction-market prices, with predictions, rooms and track records. Errors are `{ error: { code, message, details? } }`; every response carries `x-request-id`.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "A Supabase access token (or a dev token outside production)." },
        session: { type: "apiKey", in: "cookie", name: "sb-access-token", description: "The Supabase session cookie set on sign-in." },
      },
      responses: {
        Error: {
          description: Object.entries(ERRORS)
            .map(([code, text]) => `${code}: ${text}`)
            .join(" "),
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
                    required: ["code", "message"],
                  },
                },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
