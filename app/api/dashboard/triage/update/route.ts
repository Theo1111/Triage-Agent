import { NextRequest, NextResponse } from "next/server";
import { updateTriageFields } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";

interface UpdateBody {
  triageItemId?: string;
  actor?: string;
  owner?: string | null;
  summary?: string | null;
  recommendedNextStep?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateBody;
    const { triageItemId, actor } = body;

    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    const fields: { owner?: string | null; summary?: string | null; recommendedNextStep?: string | null } = {};
    if ("owner" in body) fields.owner = body.owner ?? null;
    if ("summary" in body) fields.summary = body.summary ?? null;
    if ("recommendedNextStep" in body) fields.recommendedNextStep = body.recommendedNextStep ?? null;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    const item = await updateTriageFields(triageItemId, fields);
    const actorLabel = actor?.trim() || "dashboard";

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_fields_updated",
      actorType: "human",
      actorId: actorLabel,
      action: `Updated fields [${Object.keys(fields).join(", ")}] on triage item ${triageItemId}`,
      afterState: fields as Record<string, unknown>,
    });

    if ("owner" in fields) {
      const statusText = fields.owner
        ? `✅ *Status:* Assigned to ${fields.owner} (via dashboard)`
        : `🆕 *Status:* Unassigned (via dashboard)`;
      await syncTriageItemToSlack(item, statusText);
    }

    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
