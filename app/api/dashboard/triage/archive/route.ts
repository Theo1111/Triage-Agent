import { NextRequest, NextResponse } from "next/server";
import { archiveTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ success: false, error: "Authentication required. Please log in." }, { status: 401 });
    }

    const { triageItemId } = (await req.json()) as { triageItemId?: string };
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    const actorLabel = operator.displayName ?? operator.username;
    const item = await archiveTriageItem(triageItemId, operator.username);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_archived",
      actorType: "human",
      actorId: operator.username,
      action: `Archived triage item ${triageItemId} by ${actorLabel}`,
      beforeState: { status: "active" },
      afterState:  { status: "archived" },
    });

    await syncTriageItemToSlack(item, `🗄️ *Status:* Archived by ${actorLabel}`);
    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
