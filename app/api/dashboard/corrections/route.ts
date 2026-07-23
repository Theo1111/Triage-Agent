import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import * as correctionsRepo from "@/src/repositories/humanCorrectionsRepository";
import { logEvent } from "@/src/services/agentAuditLog";

export const dynamic = "force-dynamic";

const REVIEW_STATUSES = ["pending", "approved_for_eval", "needs_context", "duplicate", "rejected"] as const;

// GET /api/dashboard/corrections?status=pending
// Lists corrections for admin review plus correction analytics.
export async function GET(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status") ?? "all";
  const status = (REVIEW_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as correctionsRepo.ReviewStatus) : "all";

  try {
    const [corrections, analytics] = await Promise.all([
      correctionsRepo.listByReviewStatus(status),
      correctionsRepo.correctionAnalytics(),
    ]);
    return NextResponse.json({ ok: true, corrections, analytics });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

// POST /api/dashboard/corrections
// { correctionId, reviewStatus } — admin marks a correction for the eval pipeline.
export async function POST(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await req.json()) as { correctionId?: string; reviewStatus?: string };
    if (!body.correctionId || !body.reviewStatus) {
      return NextResponse.json({ success: false, error: "correctionId and reviewStatus required" }, { status: 400 });
    }
    if (!(REVIEW_STATUSES as readonly string[]).includes(body.reviewStatus)) {
      return NextResponse.json({ success: false, error: `reviewStatus must be one of: ${REVIEW_STATUSES.join(", ")}` }, { status: 400 });
    }
    const updated = await correctionsRepo.updateReviewStatus(
      body.correctionId,
      body.reviewStatus as correctionsRepo.ReviewStatus,
      operator.username
    );
    if (!updated) return NextResponse.json({ success: false, error: "Correction not found" }, { status: 404 });

    await logEvent({
      eventType: "correction_reviewed",
      actorType: "human",
      actorId: operator.username,
      action: `Correction ${body.correctionId} marked ${body.reviewStatus}`,
      metadata: { correctionId: body.correctionId, reviewStatus: body.reviewStatus },
    });
    return NextResponse.json({ success: true, correction: updated });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
