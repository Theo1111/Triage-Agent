import { NextResponse } from "next/server";
import { listOperatorProfiles } from "@/src/services/operatorProfiles";
import { friendlyOperatorError } from "@/src/lib/operatorErrors";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators — list all profiles (public info only, no hashes/salts).
export async function GET() {
  try {
    const profiles = await listOperatorProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    const msg = friendlyOperatorError(err);
    console.error("[operators/list]", err);
    return NextResponse.json({ error: msg, profiles: [] }, { status: 500 });
  }
}
