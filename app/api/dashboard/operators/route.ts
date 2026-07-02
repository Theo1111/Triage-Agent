import { NextResponse } from "next/server";
import { listOperatorProfiles } from "@/src/services/operatorProfiles";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators — list all profiles (public info only, no hashes/salts).
export async function GET() {
  try {
    const profiles = await listOperatorProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
