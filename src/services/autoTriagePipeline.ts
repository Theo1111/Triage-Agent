import { classifyEmailById } from "@/src/services/emailClassificationWorker";
import { routeClassifiedEmail } from "@/src/services/slackAlerts";
import { getCurrentClassification } from "@/src/services/classification";
import { findByInboundEmailId } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import { detectThreadContext, checkIsObviousAcknowledgement } from "@/src/services/threadReplyFilter";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoTriageResult {
  inboundEmailId: string;
  skipped: boolean;
  skipReason?: string;
  classificationId: string | null;
  triageItemId: string | null;
  slackAction?: "posted" | "blocked" | "ignored";
  // Set when this email is a reply linked to an existing triage item.
  linkedTriageItemId?: string | null;
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

  // ── Thread reply detection ───────────────────────────────────────────────
  // Check BEFORE calling the AI to avoid burning tokens on obvious acks.
  const threadCtx = await detectThreadContext(email);

  if (threadCtx.isThreadReply) {
    const ackCheck = checkIsObviousAcknowledgement(email);
    const linkedTriageItemId = threadCtx.existingTriageItem?.id ?? null;

    console.log(
      `[auto-triage] thread_reply email=${inboundEmailId}` +
      ` gmailMessageId=${email.gmail_message_id}` +
      ` gmailThreadId=${email.gmail_thread_id}` +
      ` sender=${email.sender_email}` +
      ` subject="${email.subject ?? "(none)"}"` +
      ` siblings=${threadCtx.priorMessageCount}` +
      ` linkedTriageItemId=${linkedTriageItemId ?? "none"}` +
      ` isAck=${ackCheck.isAcknowledgement}` +
      ` ackReason=${ackCheck.reason}`
    );

    await logEvent({
      inboundEmailId,
      eventType: "thread_reply_received",
      action: "Email is a reply in an existing Gmail thread",
      metadata: {
        gmail_message_id: email.gmail_message_id,
        gmail_thread_id: email.gmail_thread_id,
        prior_message_count: threadCtx.priorMessageCount,
        linked_triage_item_id: linkedTriageItemId,
        sender: email.sender_email,
        subject: email.subject,
        is_acknowledgement: ackCheck.isAcknowledgement,
        ack_reason: ackCheck.reason,
      },
    });

    if (ackCheck.isAcknowledgement) {
      // Log the suppression with all required fields for debugging.
      console.log(
        `[auto-triage] suppressed=true` +
        ` suppressedReason=internal_acknowledgement_reply` +
        ` email=${inboundEmailId}` +
        ` gmailMessageId=${email.gmail_message_id}` +
        ` gmailThreadId=${email.gmail_thread_id}` +
        ` sender=${email.sender_email}` +
        ` subject="${email.subject ?? "(none)"}"` +
        (linkedTriageItemId ? ` linkedTriageItemId=${linkedTriageItemId}` : "")
      );

      await logEvent({
        inboundEmailId,
        eventType: "reply_suppressed_as_acknowledgement",
        action: "Internal acknowledgement reply suppressed — no new Slack alert created",
        reason: ackCheck.reason,
        metadata: {
          gmail_message_id: email.gmail_message_id,
          gmail_thread_id: email.gmail_thread_id,
          sender: email.sender_email,
          subject: email.subject,
          suppressed: true,
          suppressed_reason: "internal_acknowledgement_reply",
          linked_triage_item_id: linkedTriageItemId,
        },
      });

      return {
        inboundEmailId,
        skipped: true,
        skipReason: "internal_acknowledgement_reply",
        classificationId: null,
        triageItemId: null,
        linkedTriageItemId,
      };
    }

    // Non-suppressed reply (external sender, escalation signals, or body too long).
    // Fall through to full classification with thread context so the model knows
    // this is a follow-up — it should be harder to generate a new urgent alert.
    console.log(
      `[auto-triage] thread_reply not suppressed — proceeding with classification` +
      ` email=${inboundEmailId} ackReason=${ackCheck.reason}`
    );
  }

  await logEvent({
    inboundEmailId,
    eventType: "auto_triage_started",
    action: "Auto-triage pipeline started",
    metadata: {
      has_classification: !!existingClassification,
      has_triage_item: !!existingTriageItem,
      is_thread_reply: threadCtx.isThreadReply,
      linked_triage_item_id: threadCtx.existingTriageItem?.id ?? null,
    },
  });

  let classificationId: string | null = existingClassification?.id ?? null;
  let triageItemId: string | null = existingTriageItem?.id ?? null;
  let slackAction: "posted" | "blocked" | "ignored" | undefined;

  try {
    // ── Step 1: Classify ─────────────────────────────────────────────────
    if (!existingClassification) {
      // Pass thread context so the model knows this is a reply and can downgrade urgency
      // for non-escalating follow-ups.
      const classifyResult = await classifyEmailById(
        inboundEmailId,
        threadCtx.isThreadReply
          ? {
              isThreadReply: true,
              priorMessageCount: threadCtx.priorMessageCount,
              existingTriageItemId: threadCtx.existingTriageItem?.id ?? null,
              existingTriageStatus: threadCtx.existingTriageItem?.status ?? null,
            }
          : undefined
      );
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
        is_thread_reply: threadCtx.isThreadReply,
      },
    });

    console.log(
      `[auto-triage] completed email=${inboundEmailId} ` +
      `triage=${triageItemId} slack=${slackAction ?? "skipped"}`
    );

    return {
      inboundEmailId,
      skipped: false,
      classificationId,
      triageItemId,
      slackAction,
      linkedTriageItemId: threadCtx.existingTriageItem?.id ?? null,
    };
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
