import { NextRequest, NextResponse } from "next/server";
import { archiveTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";

export async function POST(req: NextRequest) {
  try {
    const { triageItemId, archivedBy } = (await req.json()) as {
      triageItemId?: string;
      archivedBy?: string;
    };
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }
    const actor = archivedBy?.trim() || "dashboard";

    const item = await archiveTriageItem(triageItemId, actor);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_archived",
      actorType: "human",
      actorId: actor,
      action: `Archived triage item ${triageItemId}`,
      beforeState: { status: "active" },
      afterState: { status: "archived" },
    });

    await syncTriageItemToSlack(item, `🗄️ *Status:* Archived by ${actor}`);

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
