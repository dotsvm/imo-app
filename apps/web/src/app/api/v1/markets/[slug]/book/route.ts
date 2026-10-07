import { z } from "zod";
import { route } from "@imo/server/http/route";
import { touchInterest } from "@imo/server/usecases/books";
import { marketBook } from "@imo/server/usecases/markets";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  handler: async ({ deps, params }) => {
    const book = await marketBook(deps, deps.db, params.slug);
    await touchInterest(deps.db, params.slug, deps.clock.now());
    return book;
  },
});
