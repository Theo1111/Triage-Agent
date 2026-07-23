import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { getDashboardHealth } from "@/src/services/dashboardHealth";

export const dynamic = "force-dynamic";

// GET /api/dashboard/health
// Aggregated operational health for operators/admins. Auth required — reveals
// internal system state (but never credentials, tokens, or email contents).
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }

    const health = await getDashboardHealth();
    return NextResponse.json({ ok: true, health });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
