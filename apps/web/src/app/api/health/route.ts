/** Liveness: the process answers. No dependencies are touched. */
export function GET() {
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
