import { classifyEmailById } from "@/src/services/emailClassificationWorker";
import {
  routeClassifiedEmail,
  buildSlackCustomerUpdateMessage,
  sendViaWebhook,
} from "@/src/services/slackAlerts";
import { getCurrentClassification } from "@/src/services/classification";
import {
  findByInboundEmailId,
  resolveTriageItem,
  escalateTriageItem,
  touchTriageItem,
} from "@/src/services/triageItems";
import { logEvent } from "@/src/services/agentAuditLog";
import {
  detectThreadContext,
  checkShouldSuppressReply,
  checkIsClosureReply,
  checkIsCustomerEscalation,
  checkIsCustomerAcknowledgement,
  extractNewReplyBody,
  isInternalSenderEmail,
  type MessageKind,
} from "@/src/services/threadReplyFilter";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import { postThreadReply } from "@/src/lib/slack/slackWebApi";
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

  // ── 2.5. Reporter closure detection ──────────────────────────────────────
  // If the original reporter sends back a reply confirming the issue is fixed,
  // auto-resolve the open triage item before any AI classification.
  if (
    threadCtx.isThreadReply &&
    threadCtx.existingTriageItem &&
    !["resolved", "archived"].includes(threadCtx.existingTriageItem.status)
  ) {
    const originalEmail = await inboundEmailsRepo.findById(
      threadCtx.existingTriageItem.inbound_email_id
    );
    const originalReporter = originalEmail?.sender_email?.toLowerCase() ?? null;
    const currentSender = (email.sender_email ?? "").toLowerCase();
    const isOriginalReporter = originalReporter !== null && currentSender === originalReporter;

    if (isOriginalReporter) {
      const newReplyBody = extractNewReplyBody(email.body_text ?? email.snippet ?? "");

      if (checkIsClosureReply(newReplyBody)) {
        console.log(
          `[auto-triage] reporter_closure detected email=${inboundEmailId}` +
          ` sender=${email.sender_email}` +
          ` triage=${linkedTriageItemId}` +
          ` body="${newReplyBody.slice(0, 120)}"`
        );

        let resolvedItem = null;
        try {
          resolvedItem = await resolveTriageItem(threadCtx.existingTriageItem.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("already resolved")) throw err;
          console.log(`[auto-triage] triage item already resolved — skipping auto-resolve`);
        }

        if (resolvedItem) {
          await syncTriageItemToSlack(
            resolvedItem,
            `✅ *Resolved* — original reporter confirmed the issue is working. (${email.sender_email ?? "sender"})`
          );
        }

        await logEvent({
          inboundEmailId: email.id,
          eventType: "auto_resolved_from_reporter_reply",
          actorType: "system",
          actorId: email.sender_email ?? "unknown",
          action: "Original reporter confirmed issue is resolved — triage item auto-resolved",
          reason: "reporter_confirmed_working",
          metadata: {
            gmail_message_id: email.gmail_message_id,
            gmail_thread_id: email.gmail_thread_id,
            linked_triage_item_id: linkedTriageItemId,
            reply_body_preview: newReplyBody.slice(0, 200),
            original_reporter: originalReporter,
          },
        });

        return {
          inboundEmailId,
          skipped: true,
          skipReason: "reporter_confirmed_resolved",
          classificationId: null,
          triageItemId: linkedTriageItemId,
          linkedTriageItemId,
          messageKind: "reporter_confirmed_resolved" as MessageKind,
        };
      }
    }
  }

  // ── 2.7. External customer update on tracked open thread ──────────────────
  // When a non-Grata sender (original reporter, property manager, customer)
  // replies to a thread that already has an open triage item:
  //   - DO NOT create a new triage item
  //   - DO NOT post a new "Urgent Email Alert" Slack card
  //   - Update the existing item (escalate if warranted, touch updated_at)
  //   - Post a compact Slack notification (thread reply if possible, else webhook)
  //   - Write audit log and return early
  //
  // Step 2.5 (closure detection) runs first, so any "fixed/working" reply
  // from the original reporter is already handled before we get here.
  if (
    threadCtx.isThreadReply &&
    threadCtx.existingTriageItem &&
    !isInternalSender &&
    !["resolved", "archived"].includes(threadCtx.existingTriageItem.status)
  ) {
    const replyBody = extractNewReplyBody(email.body_text ?? email.snippet ?? "");
    const senderDisplay =
      email.sender_name
        ? `${email.sender_name} <${email.sender_email ?? "unknown"}>`
        : (email.sender_email ?? "Unknown sender");

    // Customer acknowledgements ("Okay, thank you!", "Sounds good, thanks!", …)
    // — store the email, link to the triage item, but do NOT post any Slack output.
    // Signatures are stripped inside extractNewReplyBody before this check runs.
    if (checkIsCustomerAcknowledgement(replyBody)) {
      console.log(
        `[auto-triage] customer_acknowledgement suppressed email=${inboundEmailId}` +
        ` sender=${email.sender_email}` +
        ` triage=${linkedTriageItemId}` +
        ` body="${replyBody.slice(0, 80)}"`
      );
      await logEvent({
        inboundEmailId: email.id,
        eventType: "reply_suppressed_customer_acknowledgement",
        actorType: "system",
        actorId: email.sender_email ?? "unknown",
        action: "Customer acknowledgement suppressed — no actionable content, no Slack output",
        reason: "customer_acknowledgement",
        metadata: {
          gmail_message_id: email.gmail_message_id,
          gmail_thread_id: email.gmail_thread_id,
          linked_triage_item_id: linkedTriageItemId,
          cleaned_reply_text: replyBody.slice(0, 200),
          sender: email.sender_email,
        },
      });
      return {
        inboundEmailId,
        skipped: true,
        skipReason: "customer_acknowledgement",
        classificationId: null,
        triageItemId: linkedTriageItemId,
        linkedTriageItemId,
        messageKind: "customer_acknowledgement" as MessageKind,
      };
    }

    // Meaningful customer reply — update the existing triage item.
    const isEscalation = checkIsCustomerEscalation(replyBody);
    const messageKind: MessageKind = isEscalation ? "customer_escalation" : "customer_update";
    const eventType = isEscalation
      ? "customer_escalation_linked_to_existing_issue"
      : "customer_update_linked_to_existing_issue";

    console.log(
      `[auto-triage] ${messageKind} email=${inboundEmailId}` +
      ` sender=${email.sender_email}` +
      ` triage=${linkedTriageItemId}` +
      ` isEscalation=${isEscalation}` +
      ` body="${replyBody.slice(0, 120)}"`
    );

    let updatedTriageItem = threadCtx.existingTriageItem;

    if (isEscalation && !updatedTriageItem.escalated_at) {
      try {
        updatedTriageItem = await escalateTriageItem(updatedTriageItem.id);
        console.log(`[auto-triage] auto-escalated triage=${updatedTriageItem.id} from customer reply`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[auto-triage] escalate failed (non-fatal): ${msg}`);
      }
    } else {
      try {
        updatedTriageItem = await touchTriageItem(updatedTriageItem.id);
      } catch (err) {
        console.warn(`[auto-triage] touchTriageItem failed (non-fatal):`, err);
      }
    }

    // Slack: try thread reply first (requires bot token + stored message_ts),
    // then fall back to an update on the existing card, then post via webhook.
    const botToken = process.env.SLACK_BOT_TOKEN;
    let slackUpdatePosted = false;

    if (
      botToken &&
      updatedTriageItem.slack_channel &&
      updatedTriageItem.slack_message_ts
    ) {
      try {
        const statusLine = isEscalation
          ? `⚠️ *Escalated* — ${senderDisplay} added urgent update`
          : `🔄 *Update* — ${senderDisplay} replied`;
        const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
        const viewUrl = appBaseUrl ? `${appBaseUrl}/emails/${email.id}` : null;
        const preview = replyBody.length > 400 ? replyBody.slice(0, 400) + "…" : replyBody;
        const threadText = [
          statusLine,
          `>>> ${preview.replace(/\n+/g, "\n")}`,
          viewUrl ? `<${viewUrl}|View Thread>` : null,
        ].filter(Boolean).join("\n");

        await postThreadReply(
          botToken,
          updatedTriageItem.slack_channel,
          updatedTriageItem.slack_message_ts,
          threadText
        );
        slackUpdatePosted = true;
        console.log(`[auto-triage] slack thread reply posted triage=${updatedTriageItem.id}`);
      } catch (err) {
        console.warn(`[auto-triage] slack thread reply failed, falling back:`, err);
      }
    }

    if (!slackUpdatePosted && updatedTriageItem.slack_channel && updatedTriageItem.slack_message_ts) {
      const statusText = isEscalation
        ? `⚠️ *Escalated* — ${senderDisplay} added: "${replyBody.slice(0, 120)}"`
        : `🔄 *Updated* — ${senderDisplay} replied: "${replyBody.slice(0, 120)}"`;
      await syncTriageItemToSlack(updatedTriageItem, statusText).catch(err =>
        console.warn(`[auto-triage] syncTriageItemToSlack failed (non-fatal):`, err)
      );
      slackUpdatePosted = true;
    }

    if (!slackUpdatePosted) {
      // No stored message ref — post a distinct webhook update (not a new alert card).
      const updateMsg = buildSlackCustomerUpdateMessage({
        existingTriageItem: updatedTriageItem,
        replyEmailId: email.id,
        senderDisplay,
        replyBodyPreview: replyBody,
        isEscalation,
      });
      await sendViaWebhook(updateMsg);
      slackUpdatePosted = true;
    }

    await logEvent({
      inboundEmailId: email.id,
      eventType,
      actorType: "system",
      actorId: email.sender_email ?? "unknown",
      action: isEscalation
        ? "External customer escalation linked to existing triage item — no new issue created"
        : "External customer update linked to existing triage item — no new issue created",
      metadata: {
        gmail_message_id: email.gmail_message_id,
        gmail_thread_id: email.gmail_thread_id,
        linked_triage_item_id: linkedTriageItemId,
        is_escalation: isEscalation,
        auto_escalated: isEscalation && !threadCtx.existingTriageItem.escalated_at,
        slack_update_posted: slackUpdatePosted,
        reply_body_preview: replyBody.slice(0, 200),
        sender: email.sender_email,
      },
    });

    return {
      inboundEmailId,
      skipped: true,
      skipReason: "linked_to_existing_thread",
      classificationId: null,
      triageItemId: linkedTriageItemId,
      linkedTriageItemId,
      messageKind,
    };
  }

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
