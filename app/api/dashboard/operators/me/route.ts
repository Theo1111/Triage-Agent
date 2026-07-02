import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators/me — return the currently authenticated operator (from cookie).
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    return NextResponse.json({ operator: operator ?? null });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unknown error";
    if (raw.includes("operator_profiles") || raw.includes("42P01")) {
      // Table not yet migrated — treat as unauthenticated rather than crashing.
      return NextResponse.json({ operator: null });
    }
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
