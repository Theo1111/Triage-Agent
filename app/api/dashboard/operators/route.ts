import { NextRequest, NextResponse } from "next/server";
import { listOperatorProfiles } from "@/src/services/operatorProfiles";
import { friendlyOperatorError } from "@/src/lib/operatorErrors";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators — list all profiles (public info only, no hashes/salts).
// Requires a valid operator session: operator emails are internal information.
export async function GET(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      console.warn("[operators/list] auth required — missing or invalid session");
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const profiles = await listOperatorProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    const msg = friendlyOperatorError(err);
    console.error("[operators/list]", err);
    return NextResponse.json({ error: msg, profiles: [] }, { status: 500 });
  }
}
