/**
 * Write docs/openapi.json from the API routes.
 *   npm run openapi
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApi } from "../src/http/openapi";

async function main() {
  const doc = await buildOpenApi(join(process.cwd(), "src/app"), (file) => import(file));
  writeFileSync(join(process.cwd(), "docs/openapi.json"), `${JSON.stringify(doc, null, 2)}\n`);
  const operations = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`docs/openapi.json: ${Object.keys(doc.paths).length} paths, ${operations} operations`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
