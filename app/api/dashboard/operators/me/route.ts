import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { friendlyOperatorError } from "@/src/lib/operatorErrors";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators/me — return the currently authenticated operator (from cookie).
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    return NextResponse.json({ operator: operator ?? null });
  } catch (err) {
    const msg = friendlyOperatorError(err);
    console.error("[operators/me]", err);
    // Table missing — treat as unauthenticated so the login page still renders.
    if (msg.includes("migration") || msg.includes("not set up")) {
      return NextResponse.json({ operator: null, warning: msg });
    }
    return NextResponse.json({ operator: null, error: msg }, { status: 500 });
  }
}
