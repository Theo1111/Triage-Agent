import { NextRequest, NextResponse } from "next/server";
import { reopenTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";

export async function POST(req: NextRequest) {
  try {
    const { triageItemId, actor } = (await req.json()) as {
      triageItemId?: string;
      actor?: string;
    };
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }
    const actorLabel = actor?.trim() || "dashboard";

    const item = await reopenTriageItem(triageItemId);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_reopened",
      actorType: "human",
      actorId: actorLabel,
      action: `Reopened triage item ${triageItemId} via dashboard`,
    });

    await syncTriageItemToSlack(item, `🔄 *Status:* Reopened by ${actorLabel} (via dashboard)`);

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
