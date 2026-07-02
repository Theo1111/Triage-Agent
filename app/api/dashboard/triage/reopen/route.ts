import { NextRequest, NextResponse } from "next/server";
import { reopenTriageItem } from "@/src/services/triageItems";
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
    const item = await reopenTriageItem(triageItemId);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_reopened",
      actorType: "human",
      actorId: operator.username,
      action: `Reopened triage item ${triageItemId} by ${actorLabel} via dashboard`,
    });

    await syncTriageItemToSlack(item, `🔄 *Status:* Reopened by ${actorLabel} (via dashboard)`);
    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
