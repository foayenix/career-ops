import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { readAutopilotStatus } from "@/lib/autopilot-status.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: progress of the latest local/autopilot.mjs run, parsed from its log.
export async function GET() {
  try {
    return NextResponse.json(readAutopilotStatus(careerOpsRoot()));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
