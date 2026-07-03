import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { upsertRead } from "@/src/repositories/triageItemReadsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      // Non-critical: silently succeed when no session is present.
      return NextResponse.json({ success: true });
    }

    const { triageItemId } = (await req.json()) as { triageItemId?: string };
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    await upsertRead(triageItemId, operator.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mark-read] failed:", msg);
    // Non-critical — don't surface errors to the client.
    return NextResponse.json({ success: true });
  }
}
