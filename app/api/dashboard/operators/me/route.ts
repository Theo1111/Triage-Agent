import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators/me — return the currently authenticated operator (from cookie).
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    return NextResponse.json({ operator: operator ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
