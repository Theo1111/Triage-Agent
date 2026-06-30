import { classifyEmailById } from "@/src/services/emailClassificationWorker";
import { routeClassifiedEmail } from "@/src/services/slackAlerts";
import { getCurrentClassification } from "@/src/services/classification";
import { findByInboundEmailId } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoTriageResult {
  inboundEmailId: string;
  skipped: boolean;
  skipReason?: string;
  classificationId: string | null;
  triageItemId: string | null;
  slackAction?: "posted" | "blocked" | "ignored";
  error?: string;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────
// Idempotent: if classification + triage item already exist, skips silently.
// If only classification exists (no triage item), skips re-classification.
// Never throws — errors are caught, logged, and returned in the result.

export async function runAutoTriagePipeline(
  inboundEmailId: string
): Promise<AutoTriageResult> {
  const email = await inboundEmailsRepo.findById(inboundEmailId);
  if (!email) throw new Error(`Email not found: ${inboundEmailId}`);

  console.log(`[auto-triage] started email=${inboundEmailId} subject="${email.subject ?? "(none)"}"`);

  // ── Idempotency: check existing state ───────────────────────────────────
  const existingClassification = await getCurrentClassification(inboundEmailId);
  const existingTriageItem = await findByInboundEmailId(inboundEmailId);

  if (existingClassification && existingTriageItem) {
    console.log(
      `[auto-triage] already processed email=${inboundEmailId} ` +
      `classification=${existingClassification.id} triage=${existingTriageItem.id} — skipping`
    );
    await logEvent({
      inboundEmailId,
      classificationId: existingClassification.id,
      eventType: "auto_triage_skipped",
      action: "Email already classified and triage item exists",
      metadata: {
        classification_id: existingClassification.id,
        triage_item_id: existingTriageItem.id,
      },
    });
    return {
      inboundEmailId,
      skipped: true,
      skipReason: "already_processed",
      classificationId: existingClassification.id,
      triageItemId: existingTriageItem.id,
    };
  }

  await logEvent({
    inboundEmailId,
    eventType: "auto_triage_started",
    action: "Auto-triage pipeline started",
    metadata: {
      has_classification: !!existingClassification,
      has_triage_item: !!existingTriageItem,
    },
  });

  let classificationId: string | null = existingClassification?.id ?? null;
  let triageItemId: string | null = existingTriageItem?.id ?? null;
  let slackAction: "posted" | "blocked" | "ignored" | undefined;

  try {
    // ── Step 1: Classify ─────────────────────────────────────────────────
    if (!existingClassification) {
      const classifyResult = await classifyEmailById(inboundEmailId);
      classificationId = classifyResult.classification.id;

      console.log(
        `[auto-triage] classified email=${inboundEmailId} ` +
        `urgency=${classifyResult.classification.urgency_level} ` +
        `sensitivity=${classifyResult.classification.sensitivity_level} ` +
        `confidence=${classifyResult.classification.confidence_score} ` +
        `overrides=${classifyResult.overridesApplied.length}`
      );
    } else {
      console.log(
        `[auto-triage] classification exists email=${inboundEmailId} ` +
        `urgency=${existingClassification.urgency_level} — skipping classify step`
      );
    }

    // ── Step 2: Route → Slack + triage item ──────────────────────────────
    if (!existingTriageItem) {
      const routeResult = await routeClassifiedEmail(inboundEmailId);
      triageItemId = routeResult.triageItemId ?? null;
      slackAction = routeResult.action;

      console.log(
        `[auto-triage] routing done email=${inboundEmailId} ` +
        `slack=${routeResult.action} triage=${triageItemId} ` +
        `route=${routeResult.route_type}`
      );
    } else {
      console.log(
        `[auto-triage] triage item exists email=${inboundEmailId} ` +
        `status=${existingTriageItem.status} — skipping routing step`
      );
    }

    // ── Done ─────────────────────────────────────────────────────────────
    await logEvent({
      inboundEmailId,
      classificationId,
      eventType: "auto_triage_completed",
      action: "Auto-triage pipeline completed",
      metadata: {
        classification_id: classificationId,
        triage_item_id: triageItemId,
        slack_action: slackAction ?? "skipped",
      },
    });

    console.log(
      `[auto-triage] completed email=${inboundEmailId} ` +
      `triage=${triageItemId} slack=${slackAction ?? "skipped"}`
    );

    return { inboundEmailId, skipped: false, classificationId, triageItemId, slackAction };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auto-triage] FAILED email=${inboundEmailId}:`, message);

    await logEvent({
      inboundEmailId,
      classificationId,
      eventType: "auto_triage_failed",
      action: "Auto-triage pipeline failed",
      reason: message,
      metadata: { classification_id: classificationId, triage_item_id: triageItemId },
    });

    return { inboundEmailId, skipped: false, classificationId, triageItemId, slackAction, error: message };
  }
}
