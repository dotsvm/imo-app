import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { getServerDeps, ready } from "@imo/server/deps";
import { POST as newList } from "../../src/app/api/v1/watchlists/route";
import { resetDatabase } from "./helpers";
import { signIn } from "./http";

const deps = () => getServerDeps();
let bearer = "";

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  bearer = await signIn("security-person", "Sec Person");
});
after(async () => deps().close());

const write = (headers: Record<string, string>) =>
  newList(
    new NextRequest("http://localhost/api/v1/watchlists", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.3.0.1", ...headers },
      body: JSON.stringify({ name: "From elsewhere" }),
    }),
    { params: Promise.resolve({}) },
  );

test("a cookie-only write from another site is refused; our own pages and bearer tokens pass", async () => {
  const cookie = `hunch_dev_session=${bearer.replace(/^Bearer dev\./, "")}`;
  assert.equal((await write({ cookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await write({ cookie, origin: "http://localhost:3000" })).status, 201);
  assert.equal((await write({ authorization: bearer, origin: "https://evil.example" })).status, 201, "a bearer token isn't sent by the browser on its own");
});

test("every admin route refuses people who aren't admins", async () => {
  const root = join(process.cwd(), "src/app/api/v1/admin");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "route.ts") files.push(path);
    }
  };
  walk(root);
  assert.ok(files.length >= 12);
  let checked = 0;
  for (const file of files) {
    const handlers = (await import(file)) as Record<string, (r: NextRequest, a: { params: Promise<Record<string, string>> }) => Promise<Response>>;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const handler = handlers[method];
      if (!handler) continue;
      const res = await handler(
        new NextRequest(`http://localhost/${relative(process.cwd(), file)}`, {
          method,
          headers: { authorization: bearer, "content-type": "application/json", "x-forwarded-for": "10.4.0.1" },
          body: method === "GET" ? undefined : "{}",
        }),
        { params: Promise.resolve({ key: "beta_gate", code: "AAAA-BBBB", handle: "someone", slug: "fed-dec", id: "00000000-0000-0000-0000-000000000000" }) },
      );
      assert.equal(res.status, 403, `${method} ${relative(root, file)}`);
      checked++;
    }
  }
  assert.ok(checked >= 16, `${checked} handlers checked`);
});
