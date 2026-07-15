import { NextRequest, NextResponse } from "next/server";
import { fetchRecentAgentRuns } from "@/app/dashboard/fetchAgentRuns";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  console.log("[dashboard/agent/runs] fetch started");
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      console.warn("[dashboard/agent/runs] auth required — missing or invalid session");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const runs = await fetchRecentAgentRuns(200);
    console.log(`[dashboard/agent/runs] fetch completed runs=${runs.length}`);
    return NextResponse.json({
      ok: true,
      runs,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[dashboard/agent/runs] fetch failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
