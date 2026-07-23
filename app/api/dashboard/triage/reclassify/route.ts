import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { previewReclassification, applyReclassification } from "@/src/services/reclassify";

export const dynamic = "force-dynamic";

// POST /api/dashboard/triage/reclassify
// { triageItemId, mode: "preview" | "apply", confirmDowngrade?: boolean }
export async function POST(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await req.json()) as { triageItemId?: string; mode?: string; confirmDowngrade?: boolean };
    if (!body.triageItemId) return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });

    if (body.mode === "apply") {
      const result = await applyReclassification(body.triageItemId, {
        confirmDowngrade: !!body.confirmDowngrade,
        operator,
      });
      // 409 asks the operator to confirm a downgrade before it is applied.
      const status = result.needsConfirmation ? 409 : 200;
      return NextResponse.json({ success: result.applied, ...result }, { status });
    }

    // Default: preview (no persistence, no Slack, no case change).
    const preview = await previewReclassification(body.triageItemId);
    return NextResponse.json({ success: true, preview });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
