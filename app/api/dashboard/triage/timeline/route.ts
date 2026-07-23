import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { buildCaseTimeline } from "@/src/services/caseTimeline";

export const dynamic = "force-dynamic";

// GET /api/dashboard/triage/timeline?triageItemId=...
// Returns the case activity timeline (events + thread messages).
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }

    const triageItemId = req.nextUrl.searchParams.get("triageItemId");
    if (!triageItemId) {
      return NextResponse.json({ ok: false, error: "triageItemId required" }, { status: 400 });
    }

    const timeline = await buildCaseTimeline(triageItemId);
    return NextResponse.json({ ok: true, ...timeline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
