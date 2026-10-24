import { continueAfterLogin } from "@/lib/apply/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human signed in on the on-screen Chrome window (needsLogin) and clicked
// Continue: read the form from wherever that window is now. Never types
// credentials, never submits.
export async function POST(req: Request) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  try {
    return Response.json(await continueAfterLogin(body.sessionId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : "could not read the form" }, { status: 500 });
  }
}
