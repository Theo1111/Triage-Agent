import { EmailTriageAgent } from "@/src/agents/emailTriageAgent";
import type { ClassificationInput } from "@/src/agents/emailTriageAgent";
import { BODY_MAX_CHARS, SENSITIVE_CATEGORY_TAGS } from "@/src/config/agents";
import { TRIAGE_MODEL, TRIAGE_PROMPT_VERSION } from "@/src/config/agents";

import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import * as attachmentsRepo from "@/src/repositories/emailAttachmentsRepository";
import { createClassificationRun, finishClassificationRun, saveClassificationResult, markClassificationFailed } from "@/src/services/classification";
import { saveSensitivityDecision } from "@/src/services/sensitivityReview";
import { saveRoutingRecommendation } from "@/src/services/routingRecommendations";
import { logEvent } from "@/src/services/agentAuditLog";

import type {
  ClassificationRun,
  EmailClassification,
  SensitivityReview,
  RoutingRecommendation,
} from "@/src/types/database";

export interface ClassifyEmailResult {
  classificationRunId: string;
  classification: EmailClassification;
  sensitivityReview: SensitivityReview;
  routingRecommendation: RoutingRecommendation;
  overridesApplied: string[];
}

export async function classifyEmailById(
  inboundEmailId: string
): Promise<ClassifyEmailResult> {
  // ── 1. Fetch the stored email ────────────────────────────────────────────
  const email = await inboundEmailsRepo.findById(inboundEmailId);
  if (!email) {
    throw new Error(`Email not found: ${inboundEmailId}`);
  }

  // ── 2. Fetch attachment metadata ─────────────────────────────────────────
  const attachments = await attachmentsRepo.findByEmailId(inboundEmailId);

  // ── 3. Create classification run (status: started) ───────────────────────
  const run: ClassificationRun = await createClassificationRun({
    inboundEmailId,
    triggerType: "manual",
    modelName: TRIAGE_MODEL,
    promptVersion: TRIAGE_PROMPT_VERSION,
  });

  await logEvent({
    inboundEmailId,
    classificationRunId: run.id,
    eventType: "classification_started",
    action: "Classification run created",
    metadata: { model: TRIAGE_MODEL, trigger: "manual" },
  });

  // ── 4. Build sanitized classification input ──────────────────────────────
  const rawBody = email.body_text ?? "";
  const truncated = rawBody.length > BODY_MAX_CHARS;
  const body = truncated ? rawBody.slice(0, BODY_MAX_CHARS) : rawBody;

  const input: ClassificationInput = {
    inbound_email_id: email.id,
    source_inbox_email: email.source_inbox_email,
    sender_email: email.sender_email,
    sender_name: email.sender_name,
    recipient_emails: email.recipient_emails,
    cc_emails: email.cc_emails,
    subject: email.subject,
    snippet: email.snippet,
    body_text: body || null,
    body_text_truncated: truncated,
    label_ids: email.label_ids,
    received_at: email.received_at ? email.received_at.toISOString() : null,
    has_attachments: email.has_attachments,
    attachment_count: email.attachment_count,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      mime_type: a.mime_type,
      file_size: a.file_size,
      is_inline: a.is_inline,
      content_id: a.content_id,
    })),
  };

  // ── 5. Call the agent ────────────────────────────────────────────────────
  let agentOutput;
  try {
    agentOutput = await EmailTriageAgent.classify(input);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finishClassificationRun(run, { status: "failed", errorMessage });
    await markClassificationFailed(inboundEmailId);
    await logEvent({
      inboundEmailId,
      classificationRunId: run.id,
      eventType: "classification_failed",
      action: "OpenAI call failed",
      reason: errorMessage,
    });
    throw err;
  }

  const { output, overridesApplied, usage } = agentOutput;

  console.log(
    `[worker] email=${inboundEmailId} urgency=${output.urgency_level} ` +
    `sensitivity=${output.sensitivity_level} route=${output.route_type} ` +
    `category=${output.primary_category} confidence=${output.confidence_score} ` +
    `impact=${output.operational_impact_detected} overrides=${overridesApplied.length}`
  );
  if (output.human_language_signals.length > 0) {
    console.log(`[worker] human_signals=${JSON.stringify(output.human_language_signals)}`);
  }
  if (output.matched_vocabulary_terms.length > 0) {
    console.log(`[worker] vocab_terms=${JSON.stringify(output.matched_vocabulary_terms)}`);
  }

  if (overridesApplied.length > 0) {
    console.log("[worker] overrides applied:", overridesApplied);
  }

  // ── 6. Persist classification run (success) ──────────────────────────────
  await finishClassificationRun(run, {
    status: "success",
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    rawResponse: output as unknown as Record<string, unknown>,
  });

  // ── 7. Save email_classifications ────────────────────────────────────────
  // Use safe_slack_summary for the stored summary — it is the Slack-safe version.
  // Fall back to summary if safe_slack_summary is somehow empty.
  const summaryToStore = output.safe_slack_summary?.trim() || output.summary;

  const classification = await saveClassificationResult({
    inboundEmailId,
    classificationRunId: run.id,
    urgencyLevel: output.urgency_level,
    sensitivityLevel: output.sensitivity_level,
    primaryCategory: output.primary_category,
    categoryTags: output.category_tags,
    summary: summaryToStore,
    urgencyReason: output.urgency_reason,
    sensitivityReason: output.sensitivity_reason,
    recommendedOwner: output.recommended_owner,
    recommendedNextStep: output.recommended_next_step,
    confidenceScore: output.confidence_score,
    modelName: TRIAGE_MODEL,
    promptVersion: TRIAGE_PROMPT_VERSION,
  });

  await logEvent({
    inboundEmailId,
    classificationRunId: run.id,
    classificationId: classification.id,
    eventType: "classification_completed",
    action: "Classification saved",
    afterState: {
      urgency_level: output.urgency_level,
      sensitivity_level: output.sensitivity_level,
      primary_category: output.primary_category,
      confidence_score: output.confidence_score,
      route_type: output.route_type,
    },
    metadata: overridesApplied.length > 0 ? { overrides_applied: overridesApplied } : undefined,
  });

  // ── 8. Save sensitivity_reviews ──────────────────────────────────────────
  const isSensitive =
    output.sensitivity_level === "sensitive" || output.sensitivity_level === "private";

  const sensitivityCategories = output.category_tags.filter((tag) =>
    SENSITIVE_CATEGORY_TAGS.has(tag)
  );

  const sensitivityReview = await saveSensitivityDecision({
    inboundEmailId,
    classificationId: classification.id,
    isSensitive,
    sensitivityCategories,
    sharedSlackAllowed: output.shared_slack_allowed,
    privateRouteRequired: output.private_route_required,
    reason: output.sensitivity_reason,
    reviewStatus: "system_decision",
  });

  await logEvent({
    inboundEmailId,
    classificationRunId: run.id,
    classificationId: classification.id,
    eventType: "sensitivity_decision_saved",
    action: "Sensitivity review created",
    afterState: {
      is_sensitive: isSensitive,
      shared_slack_allowed: output.shared_slack_allowed,
      private_route_required: output.private_route_required,
      sensitivity_categories: sensitivityCategories,
    },
  });

  // ── 9. Save routing_recommendations ─────────────────────────────────────
  const routingRecommendation = await saveRoutingRecommendation({
    inboundEmailId,
    classificationId: classification.id,
    routeType: output.route_type,
    targetOwner: output.recommended_owner,
    recommendedAction: output.recommended_next_step,
    routeReason: `${output.urgency_reason} | ${output.sensitivity_reason}`,
  });

  await logEvent({
    inboundEmailId,
    classificationRunId: run.id,
    classificationId: classification.id,
    eventType: "routing_recommendation_saved",
    action: "Routing recommendation created",
    afterState: {
      route_type: output.route_type,
      target_owner: output.recommended_owner,
    },
  });

  return {
    classificationRunId: run.id,
    classification,
    sensitivityReview,
    routingRecommendation,
    overridesApplied,
  };
}
