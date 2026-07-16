import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { query } from "@/src/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authenticated(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const tokenHash = createHash("sha256").update(token).digest();
  const secretHash = createHash("sha256").update(secret).digest();
  return timingSafeEqual(tokenHash, secretHash);
}

type CountRow = { count: string | number };

export async function GET(req: NextRequest) {
  const secret = env.PAPERCLIP_HEARTBEAT_SECRET;
  if (!secret || !authenticated(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [open, urgentOpen, manualReview, escalated, failedRuns, lowConfidence] = await Promise.all([
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE status NOT IN ('resolved', 'archived', 'ignored')`,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE status NOT IN ('resolved', 'archived', 'ignored')
           AND urgency_level = 'urgent'`,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items WHERE status = 'manual_review'`,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM triage_items
         WHERE status = 'escalated' OR escalated_at IS NOT NULL`,
      ),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM classification_runs
         WHERE status = 'failed'
           AND created_at > now() - interval '7 days'`,
      ).catch(() => [{ count: 0 }]),
      query<CountRow>(
        `SELECT count(*)::int AS count FROM classification_runs
         WHERE confidence_score IS NOT NULL
           AND confidence_score < 0.7
           AND created_at > now() - interval '7 days'`,
      ).catch(() => [{ count: 0 }]),
    ]);

    const n = (rows: CountRow[]) => Number(rows[0]?.count ?? 0);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      metrics: [
        { key: "open", label: "Open items", value: n(open), severity: "info" },
        { key: "urgent_open", label: "Urgent open", value: n(urgentOpen), severity: "critical" },
        { key: "manual_review", label: "Manual review", value: n(manualReview), severity: "high" },
        { key: "escalated", label: "Escalated", value: n(escalated), severity: "high" },
        { key: "failed_runs", label: "Failed runs (7d)", value: n(failedRuns), severity: "high" },
        { key: "low_confidence", label: "Low confidence (7d)", value: n(lowConfidence), severity: "medium" },
      ],
      topItems: [],
    });
  } catch (error) {
    console.error("[paperclip/analytics] failed", error);
    return NextResponse.json({ error: "Unable to compute triage analytics." }, { status: 500 });
  }
}
