import { NextRequest, NextResponse } from "next/server";
import { getOperatorFromRequest } from "@/src/lib/dashboardOperatorSession";
import { runAutoTriagePipeline } from "@/src/services/autoTriagePipeline";
import { routeClassifiedEmail } from "@/src/services/slackAlerts";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { logEvent } from "@/src/services/agentAuditLog";
import { logger, summarizeError } from "@/src/lib/log";

export const dynamic = "force-dynamic";

// POST /api/dashboard/triage/replay
// Admin replay for stuck/failed work. Each action returns a clear result and
// records an audit event. (No role system exists yet — any authenticated
// operator may replay; see hardening notes.)
//
// kinds:
//   "reprocess" — re-run the idempotent pipeline for one email (covers awaiting,
//                 failed classification, stuck processing, and missing-case).
//   "slack"     — re-attempt Slack routing/delivery for one email.
//   "sweep"     — reprocess up to `limit` emails awaiting classification.
export async function POST(req: NextRequest) {
  const operator = await getOperatorFromRequest(req);
  if (!operator) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await req.json()) as { kind?: string; inboundEmailId?: string; limit?: number };
    const kind = body.kind ?? "reprocess";

    const audit = (action: string, meta: Record<string, unknown>) =>
      logEvent({
        inboundEmailId: body.inboundEmailId ?? null,
        eventType: "triage_replay",
        actorType: "human",
        actorId: operator.username,
        action,
        metadata: { kind, ...meta },
      });

    if (kind === "sweep") {
      const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
      const pending = await inboundEmailsRepo.findAwaitingClassification(limit);
      const results: Array<{ inboundEmailId: string; outcome: string }> = [];
      for (const email of pending) {
        try {
          const r = await runAutoTriagePipeline(email.id);
          results.push({ inboundEmailId: email.id, outcome: r.error ? `error:${r.error}` : r.skipped ? `skipped:${r.skipReason}` : "reprocessed" });
          if (r.skipped) await inboundEmailsRepo.updateProcessingStatus(email.id, "classification_ready").catch(() => {});
        } catch (err) {
          results.push({ inboundEmailId: email.id, outcome: `threw:${summarizeError(err)}` });
        }
      }
      await audit(`Replay sweep processed ${results.length} email(s)`, { count: results.length });
      return NextResponse.json({ success: true, kind, found: pending.length, results });
    }

    if (!body.inboundEmailId) {
      return NextResponse.json({ success: false, error: "inboundEmailId required for this replay kind" }, { status: 400 });
    }

    if (kind === "slack") {
      const result = await routeClassifiedEmail(body.inboundEmailId);
      await audit(`Replay Slack delivery for email ${body.inboundEmailId}`, { action: result.action });
      return NextResponse.json({ success: true, kind, result: { action: result.action, eligible: result.eligible } });
    }

    // reprocess (default) — idempotent pipeline re-run.
    const r = await runAutoTriagePipeline(body.inboundEmailId);
    await audit(`Replay reprocess for email ${body.inboundEmailId}`, { skipped: r.skipped, error: r.error ?? null });
    return NextResponse.json({
      success: !r.error,
      kind,
      result: { skipped: r.skipped, skipReason: r.skipReason, triageItemId: r.triageItemId, error: r.error ?? null },
    });
  } catch (err) {
    logger.error("triage.replay.failed", { outcome: "error", error: summarizeError(err) });
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
