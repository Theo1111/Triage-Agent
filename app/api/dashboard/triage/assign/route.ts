import { NextRequest, NextResponse } from "next/server";
import { assignTriageItem } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { resolveAssignmentOwner, type OwnerKind } from "@/src/lib/assignmentOwner";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const operator = await getOperatorFromRequest(req);
    if (!operator) {
      return NextResponse.json({ success: false, error: "Authentication required. Please log in." }, { status: 401 });
    }

    const body = (await req.json()) as {
      triageItemId?: string;
      owner?: string;
      // "self" (ignore client owner), "operator" (validated against profiles),
      // or "team" (validated against the known team list).
      ownerKind?: OwnerKind;
    };
    const { triageItemId, ownerKind } = body;
    if (!triageItemId) {
      return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    }

    // New, validated path — never accepts an arbitrary free-text operator.
    let ownerValue: string;
    let ownerLabel: string;
    if (ownerKind) {
      try {
        const resolved = await resolveAssignmentOwner({
          ownerKind,
          owner: body.owner ?? null,
          actingOperator: operator,
        });
        ownerValue = resolved.owner;
        ownerLabel = resolved.label;
      } catch (validationErr) {
        const msg = validationErr instanceof Error ? validationErr.message : "Invalid assignment";
        return NextResponse.json({ success: false, error: msg }, { status: 400 });
      }
    } else {
      // Legacy fallback (kept so any older caller keeps working). Requires a
      // non-empty owner string; no operator validation.
      if (!body.owner?.trim()) {
        return NextResponse.json({ success: false, error: "owner required" }, { status: 400 });
      }
      ownerValue = body.owner.trim();
      ownerLabel = ownerValue;
    }

    const actorLabel = operator.displayName ?? operator.username;
    const item = await assignTriageItem(triageItemId, ownerValue);

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      eventType: "dashboard_owner_changed",
      actorType: "human",
      actorId: operator.username,
      action: `Assigned triage item ${triageItemId} to ${ownerLabel} via dashboard (by ${actorLabel})`,
      afterState: { owner: item.owner },
    });

    await syncTriageItemToSlack(item, `✅ *Status:* Assigned to ${ownerLabel} by ${actorLabel} (via dashboard)`);
    return NextResponse.json({ success: true, triageItem: item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
