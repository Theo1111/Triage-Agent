import { NextRequest, NextResponse } from "next/server";
import { updateTriageFields } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";

export const dynamic = "force-dynamic";

interface UpdateBody {
  triageItemId?: string;
  owner?: string | null;
  summary?: string | null;
  recommendedNextStep?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ success: false, error: "Authentication required. Please log in." }, { status: 401 });
    }

    const body = (await req.json()) as UpdateBody;
    const { triageItemId } = body;
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    const fields: { owner?: string | null; summary?: string | null; recommendedNextStep?: string | null } = {};
    if ("owner"               in body) fields.owner               = body.owner               ?? null;
    if ("summary"             in body) fields.summary             = body.summary             ?? null;
    if ("recommendedNextStep" in body) fields.recommendedNextStep = body.recommendedNextStep ?? null;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    const actorLabel = operator.displayName ?? operator.username;
    const item = await updateTriageFields(triageItemId, fields);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_fields_updated",
      actorType: "human",
      actorId: operator.username,
      action: `Updated fields [${Object.keys(fields).join(", ")}] on triage item ${triageItemId} by ${actorLabel}`,
      afterState: fields as Record<string, unknown>,
    });

    if ("owner" in fields) {
      const statusText = fields.owner
        ? `✅ *Status:* Assigned to ${fields.owner} by ${actorLabel} (via dashboard)`
        : `🆕 *Status:* Unassigned by ${actorLabel} (via dashboard)`;
      await syncTriageItemToSlack(item, statusText);
    }

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
