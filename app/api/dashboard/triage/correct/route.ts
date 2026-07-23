import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import * as triageRepo from "@/src/repositories/triageItemsRepository";
import { getCurrentClassification } from "@/src/services/classification";
import * as correctionsRepo from "@/src/repositories/humanCorrectionsRepository";
import { logEvent } from "@/src/services/agentAuditLog";
import {
  aiFieldsFromTriage,
  computeEffectiveClassification,
  changedFields,
} from "@/src/services/effectiveClassification";
import {
  isUrgency,
  isSensitivity,
  isPrimaryCategory,
  isRecommendedOwner,
  isRouteType,
} from "@/src/evaluation/vocabulary";
import { TRIAGE_MODEL, TRIAGE_PROMPT_VERSION } from "@/src/config/agents";

export const dynamic = "force-dynamic";

interface CorrectionBody {
  relevance?: string | null;
  urgency_level?: string | null;
  sensitivity_level?: string | null;
  primary_category?: string | null;
  recommended_owner?: string | null;
  route_type?: string | null;
  slack_eligible?: boolean | null;
  manual_review_required?: boolean | null;
  summary?: string | null;
  recommended_next_step?: string | null;
}

// Validate any provided enum fields against the agent's exact vocabulary.
function validateCorrections(c: CorrectionBody): string[] {
  const errs: string[] = [];
  if (c.relevance != null && c.relevance !== "actionable" && c.relevance !== "irrelevant")
    errs.push(`invalid relevance "${c.relevance}"`);
  if (c.urgency_level != null && !isUrgency(c.urgency_level)) errs.push(`invalid urgency_level "${c.urgency_level}"`);
  if (c.sensitivity_level != null && !isSensitivity(c.sensitivity_level)) errs.push(`invalid sensitivity_level "${c.sensitivity_level}"`);
  if (c.primary_category != null && !isPrimaryCategory(c.primary_category)) errs.push(`invalid primary_category "${c.primary_category}"`);
  if (c.recommended_owner != null && !isRecommendedOwner(c.recommended_owner)) errs.push(`invalid recommended_owner "${c.recommended_owner}"`);
  if (c.route_type != null && !isRouteType(c.route_type)) errs.push(`invalid route_type "${c.route_type}"`);
  return errs;
}

// GET — latest correction + effective classification for a case.
export async function GET(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const triageItemId = req.nextUrl.searchParams.get("triageItemId");
  if (!triageItemId) return NextResponse.json({ ok: false, error: "triageItemId required" }, { status: 400 });

  try {
    const item = await triageRepo.findById(triageItemId);
    if (!item) return NextResponse.json({ ok: false, error: "Triage item not found" }, { status: 404 });
    const classification = await getCurrentClassification(item.inbound_email_id).catch(() => null);
    const latest = await correctionsRepo.findLatestByTriageItemId(triageItemId);
    const ai = aiFieldsFromTriage(item, classification);
    const effective = computeEffectiveClassification(ai, latest as never);
    return NextResponse.json({ ok: true, effective, ai, correction: latest });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// POST — record an operator correction (separate layer; never overwrites the AI result).
export async function POST(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await req.json()) as { triageItemId?: string; reason?: string; corrections?: CorrectionBody };
    if (!body.triageItemId) return NextResponse.json({ success: false, error: "triageItemId required" }, { status: 400 });
    if (!body.reason?.trim()) return NextResponse.json({ success: false, error: "A correction reason is required" }, { status: 400 });
    const corrections = body.corrections ?? {};

    const problems = validateCorrections(corrections);
    if (problems.length) return NextResponse.json({ success: false, error: problems.join("; ") }, { status: 400 });

    // At least one field must actually be corrected.
    const provided = Object.entries(corrections).filter(([, v]) => v !== undefined && v !== null);
    if (provided.length === 0) return NextResponse.json({ success: false, error: "No corrected fields provided" }, { status: 400 });

    const item = await triageRepo.findById(body.triageItemId);
    if (!item) return NextResponse.json({ success: false, error: "Triage item not found" }, { status: 404 });
    const classification = await getCurrentClassification(item.inbound_email_id).catch(() => null);
    const ai = aiFieldsFromTriage(item, classification);

    const changes = changedFields(ai, corrections);

    const row = await correctionsRepo.insertCorrection({
      triageItemId: item.id,
      inboundEmailId: item.inbound_email_id,
      classificationId: classification?.id ?? item.classification_id ?? null,
      operatorProfileId: operator.id,
      operatorUsername: operator.username,
      fields: corrections,
      original: ai as unknown as Record<string, unknown>,
      corrected: corrections as Record<string, unknown>,
      reason: body.reason.trim(),
      modelName: classification?.model_name ?? TRIAGE_MODEL,
      promptVersion: classification?.prompt_version ?? TRIAGE_PROMPT_VERSION,
    });

    await logEvent({
      inboundEmailId: item.inbound_email_id,
      classificationId: classification?.id ?? null,
      eventType: "dashboard_classification_corrected",
      actorType: "human",
      actorId: operator.username,
      action: `Corrected classification for triage item ${item.id}`,
      reason: body.reason.trim(),
      metadata: { changedFields: changes.map(c => c.field), correctionId: row.id },
    });

    const effective = computeEffectiveClassification(ai, row as never);
    return NextResponse.json({ success: true, correction: row, effective });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
