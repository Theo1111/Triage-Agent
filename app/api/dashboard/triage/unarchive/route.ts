import { NextRequest, NextResponse } from "next/server";
import { unarchiveTriageItem } from "@/src/services/triageItems";
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

    let item;
    try {
      item = await unarchiveTriageItem(triageItemId, operator.username);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("not_archived:")) {
        return NextResponse.json({ success: false, error: "This item is not archived." }, { status: 409 });
      }
      if (msg.startsWith("item_not_found:")) {
        return NextResponse.json({ success: false, error: "Triage item not found." }, { status: 404 });
      }
      throw err;
    }

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_unarchived",
      actorType: "human",
      actorId: operator.username,
      action: `Restored triage item ${triageItemId} from archive by ${actorLabel}`,
      beforeState: { status: "archived" },
      afterState:  { status: item.status },
    });

    // Restore the Slack card to reflect the active status again.
    await syncTriageItemToSlack(
      item,
      `↩️ *Restored* — returned to active triage by ${actorLabel}`
    ).catch(() => null);

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
