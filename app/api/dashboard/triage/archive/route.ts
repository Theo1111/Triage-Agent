import { NextRequest, NextResponse } from "next/server";
import { archiveTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { deleteSlackMessage } from "@/src/lib/slack/slackWebApi";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ success: false, error: "Authentication required. Please log in." }, { status: 401 });
    }

    const body = (await req.json()) as { triageItemId?: string; archivedReason?: string };
    const { triageItemId, archivedReason } = body;
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    const actorLabel = operator.displayName ?? operator.username;

    let item;
    try {
      item = await archiveTriageItem(triageItemId, operator.username, archivedReason ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("already_archived:")) {
        return NextResponse.json({ success: false, error: "This item is already archived." }, { status: 409 });
      }
      throw err;
    }

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_item_archived",
      actorType: "human",
      actorId: operator.username,
      action: `Archived triage item ${triageItemId} by ${actorLabel}`,
      beforeState: { status: "active" },
      afterState:  { status: "archived", archived_reason: archivedReason ?? null },
    });

    // Slack cleanup: delete if configured, otherwise compact update.
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken && item.slack_channel && item.slack_message_ts) {
      if (process.env.SLACK_DELETE_ARCHIVED_MESSAGES === "true") {
        const deleted = await deleteSlackMessage(botToken, item.slack_channel, item.slack_message_ts);
        if (!deleted) {
          // Delete failed (e.g. message too old, wrong scope) — fall back to compact update
          await syncTriageItemToSlack(item, `🗄️ *Archived* — removed from active triage by ${actorLabel}`).catch(() => null);
        }
      } else {
        await syncTriageItemToSlack(item, `🗄️ *Archived* — removed from active triage by ${actorLabel}`).catch(() => null);
      }
    }

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
