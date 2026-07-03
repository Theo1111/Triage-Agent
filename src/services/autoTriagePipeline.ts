import { classifyEmailById } from "@/src/services/emailClassificationWorker";
import { routeClassifiedEmail } from "@/src/services/slackAlerts";
import { getCurrentClassification } from "@/src/services/classification";
import { findByInboundEmailId } from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import {
  detectThreadContext,
  checkShouldSuppressReply,
  isInternalSenderEmail,
  type MessageKind,
} from "@/src/services/threadReplyFilter";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoTriageResult {
  inboundEmailId: string;
  skipped: boolean;
  skipReason?: string;
  classificationId: string | null;
  triageItemId: string | null;
  slackAction?: "posted" | "blocked" | "ignored";
  linkedTriageItemId?: string | null;
  messageKind?: MessageKind;
  error?: string;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────
// Order of checks:
//   1. Idempotency — already fully processed → skip
//   2. Thread detection — is this a reply?
//   3. Heuristic pre-filter — obvious internal ack/coordination → suppress before AI
//   4. AI classification (with quoted content stripped, thread context injected)
//   5. Deterministic guard — internal sender + existing tracked thread → suppress even if AI said urgent
//   6. Route → Slack + triage item (only for emails that survive all guards)

export async function runAutoTriagePipeline(
  inboundEmailId: string
): Promise<AutoTriageResult> {
  const email = await inboundEmailsRepo.findById(inboundEmailId);
  if (!email) throw new Error(`Email not found: ${inboundEmailId}`);

  console.log(`[auto-triage] started email=${inboundEmailId} subject="${email.subject ?? "(none)"}"`);

  // ── 1. Idempotency ────────────────────────────────────────────────────────
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
      metadata: { classification_id: existingClassification.id, triage_item_id: existingTriageItem.id },
    });
    return {
      inboundEmailId,
      skipped: true,
      skipReason: "already_processed",
      classificationId: existingClassification.id,
      triageItemId: existingTriageItem.id,
    };
  }

  // ── 2. Thread detection ───────────────────────────────────────────────────
  const threadCtx = await detectThreadContext(email);
  const linkedTriageItemId = threadCtx.existingTriageItem?.id ?? null;
  const isInternalSender = isInternalSenderEmail(email.sender_email ?? "");

  if (threadCtx.isThreadReply) {
    // ── 3. Heuristic pre-filter ─────────────────────────────────────────────
    // Runs before any AI call. Catches obvious acks and internal coordination messages.
    const suppress = checkShouldSuppressReply(email);

    console.log(
      `[auto-triage] isReply=true` +
      ` gmailMessageId=${email.gmail_message_id}` +
      ` gmailThreadId=${email.gmail_thread_id}` +
      ` subject="${email.subject ?? "(none)"}"` +
      ` sender=${email.sender_email}` +
      ` isInternalSender=${isInternalSender}` +
      ` existingTriageItemId=${linkedTriageItemId ?? "none"}` +
      ` newReplyBodyLength=${suppress.newReplyBodyLength}` +
      ` messageKind=${suppress.messageKind}` +
      ` suppressed=${suppress.shouldSuppress}` +
      ` suppressionReason=${suppress.reason}`
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
        is_internal_sender: isInternalSender,
        new_reply_body_length: suppress.newReplyBodyLength,
        message_kind: suppress.messageKind,
        suppressed: suppress.shouldSuppress,
        suppression_reason: suppress.reason,
      },
    });

    if (suppress.shouldSuppress) {
      const suppressEvent =
        suppress.messageKind === "internal_coordination"
          ? "reply_suppressed_internal_coordination"
          : "reply_suppressed_as_acknowledgement";

      console.log(
        `[auto-triage] suppressed=true` +
        ` suppressionReason=${suppress.reason}` +
        ` messageKind=${suppress.messageKind}` +
        ` email=${inboundEmailId}` +
        ` gmailMessageId=${email.gmail_message_id}` +
        ` gmailThreadId=${email.gmail_thread_id}` +
        ` sender=${email.sender_email}` +
        ` subject="${email.subject ?? "(none)"}"` +
        (linkedTriageItemId ? ` linkedTriageItemId=${linkedTriageItemId}` : "")
      );

      await logEvent({
        inboundEmailId,
        eventType: suppressEvent,
        action: `Internal reply suppressed (heuristic) — no new Slack alert`,
        reason: suppress.reason,
        metadata: {
          gmail_message_id: email.gmail_message_id,
          gmail_thread_id: email.gmail_thread_id,
          sender: email.sender_email,
          subject: email.subject,
          suppressed: true,
          suppressed_reason: suppress.reason,
          message_kind: suppress.messageKind,
          new_reply_body_length: suppress.newReplyBodyLength,
          linked_triage_item_id: linkedTriageItemId,
        },
      });

      return {
        inboundEmailId,
        skipped: true,
        skipReason: suppress.reason,
        classificationId: null,
        triageItemId: null,
        linkedTriageItemId,
        messageKind: suppress.messageKind,
      };
    }

    // Not suppressed by heuristic — proceed to AI with thread context + stripped body.
    console.log(
      `[auto-triage] thread_reply proceeding to classification` +
      ` email=${inboundEmailId} reason=${suppress.reason}`
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
      linked_triage_item_id: linkedTriageItemId,
    },
  });

  let classificationId: string | null = existingClassification?.id ?? null;
  let triageItemId: string | null = existingTriageItem?.id ?? null;
  let slackAction: "posted" | "blocked" | "ignored" | undefined;

  try {
    // ── 4. AI classification ──────────────────────────────────────────────────
    // For thread replies, emailClassificationWorker strips quoted content before
    // sending to the AI, so it classifies the new reply text only.
    if (!existingClassification) {
      const classifyResult = await classifyEmailById(
        inboundEmailId,
        threadCtx.isThreadReply
          ? {
              isThreadReply: true,
              priorMessageCount: threadCtx.priorMessageCount,
              existingTriageItemId: linkedTriageItemId,
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

    // ── 5. Deterministic guard ────────────────────────────────────────────────
    // Belt-and-suspenders: even if the AI returned "urgent" (e.g. because it glimpsed
    // residual quoted content), an internal-sender reply on an already-tracked thread
    // must never generate a new Slack alert. This guard is AI-proof.
    if (
      threadCtx.isThreadReply &&
      threadCtx.existingTriageItem &&
      isInternalSender
    ) {
      console.log(
        `[auto-triage] suppressed=true` +
        ` suppressionReason=internal_reply_in_tracked_thread` +
        ` email=${inboundEmailId}` +
        ` gmailMessageId=${email.gmail_message_id}` +
        ` gmailThreadId=${email.gmail_thread_id}` +
        ` sender=${email.sender_email}` +
        ` subject="${email.subject ?? "(none)"}"` +
        ` linkedTriageItemId=${linkedTriageItemId}`
      );

      await logEvent({
        inboundEmailId,
        classificationId,
        eventType: "reply_suppressed_internal_coordination",
        action: "Internal reply in tracked thread suppressed (deterministic guard) — no new Slack alert",
        reason: "internal_reply_in_tracked_thread",
        metadata: {
          gmail_message_id: email.gmail_message_id,
          gmail_thread_id: email.gmail_thread_id,
          sender: email.sender_email,
          subject: email.subject,
          suppressed: true,
          suppressed_reason: "internal_reply_in_tracked_thread",
          linked_triage_item_id: linkedTriageItemId,
          classification_id: classificationId,
        },
      });

      return {
        inboundEmailId,
        skipped: true,
        skipReason: "internal_reply_in_tracked_thread",
        classificationId,
        triageItemId: null,
        linkedTriageItemId,
      };
    }

    // ── 6. Route → Slack + triage item ────────────────────────────────────────
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
      linkedTriageItemId,
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
