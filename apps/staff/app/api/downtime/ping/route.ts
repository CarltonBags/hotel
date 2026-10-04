export const dynamic = "force-dynamic";

/** The desk's heartbeat: answers while the service is reachable (ticket 86). */
export function GET(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
