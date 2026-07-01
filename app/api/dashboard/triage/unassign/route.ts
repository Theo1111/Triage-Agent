import { NextRequest, NextResponse } from "next/server";
import { unassignTriageItem } from "@/src/services/triageItems";
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

    const { item, ownershipError } = await unassignTriageItem(triageItemId, actorLabel);

    if (ownershipError) {
      return NextResponse.json({ success: false, error: ownershipError }, { status: 403 });
    }

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_owner_changed",
      actorType: "human",
      actorId: actorLabel,
      action: `Unassigned triage item ${triageItemId} via dashboard`,
      afterState: { owner: null },
    });

    await syncTriageItemToSlack(
      item,
      `🆕 *Status:* Unassigned by ${actorLabel} (via dashboard)`
    );

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
