import { NextRequest, NextResponse } from "next/server";
import { runAutoTriagePipeline } from "@/src/services/autoTriagePipeline";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { env } from "@/src/config/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/process-pending-emails
// Failsafe sweeper: classifies stored inbound_emails still stuck at
// processing_status='awaiting_classification'. Covers two gaps:
//   1. AUTO_TRIAGE_NEW_EMAILS unset/false in the deployment env — ingestion
//      stores emails but never triggers the pipeline.
//   2. Transient pipeline failures (OpenAI/DB/Slack) — the inline trigger runs
//      once at ingestion time and nothing retried afterwards.
//
// Runs the same runAutoTriagePipeline used at ingestion, so all idempotency,
// thread-dedup, and suppression guards apply. Safe to run repeatedly.
//
// Protection: requires Authorization: Bearer <CRON_SECRET> when CRON_SECRET is
// set (same pattern as renew-gmail-watches). Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<host>/api/cron/process-pending-emails?limit=25"

export async function GET(req: NextRequest) {
  const cronSecret = env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== cronSecret) {
      console.warn("[cron/process-pending-emails] Unauthorized request — bad or missing CRON_SECRET");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[cron/process-pending-emails] CRON_SECRET not set — allowing unauthenticated request (dev only)");
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 25;

  try {
    const pending = await inboundEmailsRepo.findAwaitingClassification(limit);
    console.log(`[cron/process-pending-emails] found=${pending.length} limit=${limit}`);

    const results: Array<{
      inboundEmailId: string;
      subject: string | null;
      outcome: string;
      triageItemId?: string | null;
      error?: string;
    }> = [];
    let processed = 0;
    let failed = 0;

    // Sequential on purpose: keeps DB/OpenAI/Slack load flat and preserves
    // oldest-first thread ordering so replies never process before their parent.
    for (const email of pending) {
      try {
        const result = await runAutoTriagePipeline(email.id);
        processed++;
        results.push({
          inboundEmailId: email.id,
          subject: email.subject,
          outcome: result.error
            ? `pipeline_error: ${result.error}`
            : result.skipped
              ? `skipped: ${result.skipReason}`
              : "classified",
          triageItemId: result.triageItemId,
        });
        if (result.error) {
          failed++;
        } else if (result.skipped) {
          // Suppressed/linked replies return early without classifying, which
          // leaves processing_status at 'awaiting_classification'. Mark them
          // complete so the sweeper doesn't reprocess them on every run.
          await inboundEmailsRepo
            .updateProcessingStatus(email.id, "classification_ready")
            .catch(err =>
              console.warn(`[cron/process-pending-emails] status update failed email=${email.id}:`, err)
            );
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/process-pending-emails] pipeline failed email=${email.id}:`, msg);
        results.push({ inboundEmailId: email.id, subject: email.subject, outcome: "threw", error: msg });
      }
    }

    console.log(
      `[cron/process-pending-emails] done found=${pending.length} processed=${processed} failed=${failed}`
    );

    return NextResponse.json({
      ok: failed === 0,
      found: pending.length,
      processed,
      failed,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/process-pending-emails] Unhandled error:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
