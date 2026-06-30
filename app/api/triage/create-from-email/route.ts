import { NextRequest, NextResponse } from "next/server";
import { createTriageItemFromClassification } from "@/src/services/triageItems";
import { getCurrentClassification } from "@/src/services/classification";
import { getCurrentSensitivityReview } from "@/src/services/sensitivityReview";
import { getCurrentRoutingRecommendation } from "@/src/services/routingRecommendations";

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

  const { inboundEmailId } = (body ?? {}) as Record<string, unknown>;
  if (typeof inboundEmailId !== "string" || !inboundEmailId.trim()) {
    return NextResponse.json(
      { error: "Missing required field: inboundEmailId (string)" },
      { status: 400 }
    );
  }

  try {
    const classification = await getCurrentClassification(inboundEmailId);
    if (!classification) {
      return NextResponse.json(
        {
          error: `No classification found for email ${inboundEmailId}. Run /api/classification/classify-email first.`,
        },
        { status: 404 }
      );
    }

    const sensitivityReview = await getCurrentSensitivityReview(inboundEmailId);
    const routingRecommendation = await getCurrentRoutingRecommendation(inboundEmailId);

    // Derive the Slack action from the current classification state.
    let slackAction: "posted" | "blocked" | "ignored";
    if (
      classification.urgency_level === "not_relevant" ||
      routingRecommendation?.route_type === "ignore"
    ) {
      slackAction = "ignored";
    } else if (
      classification.urgency_level === "urgent" &&
      classification.sensitivity_level === "public_internal" &&
      (sensitivityReview?.shared_slack_allowed ?? false) &&
      routingRecommendation?.route_type === "slack_channel"
    ) {
      slackAction = "posted";
    } else {
      slackAction = "blocked";
    }

    const triageItem = await createTriageItemFromClassification({
      inboundEmailId,
      slackAction,
    });

    if (!triageItem) {
      return NextResponse.json({
        success: true,
        created: false,
        slackAction,
        reason: "Email is not_relevant — no triage item created (audit log records the skip)",
      });
    }

    return NextResponse.json({ success: true, created: true, slackAction, triageItem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[triage/create-from-email] ${inboundEmailId}:`, message);
    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to create triage item", details: message },
      { status: 500 }
    );
  }
}
