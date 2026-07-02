import { NextRequest, NextResponse } from "next/server";
import { assignTriageItem } from "@/src/services/triageItems";
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

    const { triageItemId, owner } = (await req.json()) as {
      triageItemId?: string;
      owner?: string;
    };
    if (!triageItemId || !owner?.trim()) {
      return NextResponse.json({ success: false, error: "triageItemId and owner required" }, { status: 400 });
    }

    const actorLabel = operator.displayName ?? operator.username;
    const item = await assignTriageItem(triageItemId, owner.trim());

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_owner_changed",
      actorType: "human",
      actorId: operator.username,
      action: `Assigned triage item ${triageItemId} to ${owner.trim()} via dashboard (by ${actorLabel})`,
      afterState: { owner: owner.trim() },
    });

    await syncTriageItemToSlack(item, `✅ *Status:* Assigned to ${owner.trim()} by ${actorLabel} (via dashboard)`);
    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
