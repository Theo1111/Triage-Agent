import { NextRequest, NextResponse } from "next/server";
import { assignTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";

export async function POST(req: NextRequest) {
  try {
    const { triageItemId, owner, actor } = (await req.json()) as {
      triageItemId?: string;
      owner?: string;
      actor?: string;
    };
    if (!triageItemId || !owner?.trim()) {
      return NextResponse.json(
        { success: false, error: "triageItemId and owner required" },
        { status: 400 }
      );
    }
    const actorLabel = actor?.trim() || owner.trim();

    const item = await assignTriageItem(triageItemId, owner.trim());

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_owner_changed",
      actorType: "human",
      actorId: actorLabel,
      action: `Assigned triage item ${triageItemId} to ${owner.trim()} via dashboard`,
      afterState: { owner: owner.trim() },
    });

    await syncTriageItemToSlack(item, `✅ *Status:* Assigned to ${owner.trim()} (via dashboard)`);

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
