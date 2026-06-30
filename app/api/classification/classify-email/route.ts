import { NextRequest, NextResponse } from "next/server";
import { classifyEmailById } from "@/src/services/emailClassificationWorker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("inboundEmailId" in body) ||
    typeof (body as Record<string, unknown>).inboundEmailId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing required field: inboundEmailId (string)" },
      { status: 400 }
    );
  }

  const { inboundEmailId } = body as { inboundEmailId: string };

  if (!inboundEmailId.trim()) {
    return NextResponse.json({ error: "inboundEmailId cannot be empty" }, { status: 400 });
  }

  console.log(`[classify-email] Starting classification for email: ${inboundEmailId}`);

  try {
    const result = await classifyEmailById(inboundEmailId);

    console.log(
      `[classify-email] Done. runId=${result.classificationRunId} ` +
      `urgency=${result.classification.urgency_level} ` +
      `route=${result.routingRecommendation.route_type} ` +
      `overrides=${result.overridesApplied.length}`
    );

    return NextResponse.json({
      success: true,
      classificationRunId: result.classificationRunId,
      overridesApplied: result.overridesApplied,
      classification: {
        id: result.classification.id,
        urgency_level: result.classification.urgency_level,
        sensitivity_level: result.classification.sensitivity_level,
        primary_category: result.classification.primary_category,
        category_tags: result.classification.category_tags,
        summary: result.classification.summary,
        urgency_reason: result.classification.urgency_reason,
        sensitivity_reason: result.classification.sensitivity_reason,
        recommended_owner: result.classification.recommended_owner,
        recommended_next_step: result.classification.recommended_next_step,
        confidence_score: result.classification.confidence_score,
        model_name: result.classification.model_name,
      },
      sensitivityReview: {
        id: result.sensitivityReview.id,
        is_sensitive: result.sensitivityReview.is_sensitive,
        sensitivity_categories: result.sensitivityReview.sensitivity_categories,
        shared_slack_allowed: result.sensitivityReview.shared_slack_allowed,
        private_route_required: result.sensitivityReview.private_route_required,
        review_status: result.sensitivityReview.review_status,
      },
      routingRecommendation: {
        id: result.routingRecommendation.id,
        route_type: result.routingRecommendation.route_type,
        target_owner: result.routingRecommendation.target_owner,
        recommended_action: result.routingRecommendation.recommended_action,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[classify-email] Failed for email ${inboundEmailId}:`, message);

    if (message.includes("Email not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: "Classification failed", details: message }, { status: 500 });
  }
}
