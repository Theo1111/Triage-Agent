// Safe reclassification of an existing case. Preview computes a fresh
// classification without persisting; apply persists a new classification version
// (the old one is preserved via is_current=false — never deleted), updates the
// existing canonical triage case in place (no duplicate, no second standalone
// Slack post), and refuses to silently downgrade sensitive/urgent content without
// explicit confirmation. Attachment ingestion is NOT re-run.

import { EmailTriageAgent } from "@/src/agents/emailTriageAgent";
import { classifyEmailById } from "@/src/services/emailClassificationWorker";
import { getCurrentClassification } from "@/src/services/classification";
import * as triageRepo from "@/src/repositories/triageItemsRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { cleanEmailBodyForTriage } from "@/src/lib/cleanEmailBody";
import {
  aiFieldsFromTriage,
  changedFields,
  type ClassificationFields,
} from "@/src/services/effectiveClassification";
import { deriveSlackEligible } from "@/src/evaluation/scoring";
import { logEvent } from "@/src/services/agentAuditLog";
import { syncTriageItemToSlack } from "@/src/lib/slack/syncTriageToSlack";
import type { OperatorProfilePublic } from "@/src/services/operatorProfiles";

const BODY_MAX = 8000;

export function isDowngrade(current: ClassificationFields, proposed: ClassificationFields): boolean {
  const sensRank = (s: string) => (s === "sensitive" ? 2 : s === "private" ? 1 : 0);
  const urgRank = (u: string) => (u === "urgent" ? 2 : u === "normal" ? 1 : 0);
  return sensRank(proposed.sensitivity_level) < sensRank(current.sensitivity_level) ||
    urgRank(proposed.urgency_level) < urgRank(current.urgency_level);
}

async function runPreviewClassifier(triageItemId: string): Promise<{
  current: ClassificationFields;
  proposed: ClassificationFields;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  downgrade: boolean;
}> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  const email = await inboundEmailsRepo.findById(item.inbound_email_id);
  if (!email) throw new Error(`Email not found: ${item.inbound_email_id}`);
  const classification = await getCurrentClassification(item.inbound_email_id).catch(() => null);

  const cleaned = cleanEmailBodyForTriage(email.body_text ?? "").slice(0, BODY_MAX);
  const { output } = await EmailTriageAgent.classify({
    inbound_email_id: email.id,
    source_inbox_email: email.source_inbox_email,
    sender_email: email.sender_email,
    sender_name: email.sender_name,
    recipient_emails: email.recipient_emails,
    cc_emails: email.cc_emails,
    subject: email.subject,
    snippet: email.snippet,
    body_text: cleaned,
    body_text_truncated: (email.body_text ?? "").length > BODY_MAX,
    label_ids: email.label_ids,
    received_at: email.received_at ? email.received_at.toISOString() : null,
    has_attachments: email.has_attachments,
    attachment_count: email.attachment_count,
    attachments: [],
  } as never);

  const current = aiFieldsFromTriage(item, classification);
  const proposed: ClassificationFields = {
    relevance: output.urgency_level === "not_relevant" ? "irrelevant" : "actionable",
    urgency_level: output.urgency_level,
    sensitivity_level: output.sensitivity_level,
    primary_category: output.primary_category,
    recommended_owner: output.recommended_owner,
    route_type: output.route_type,
    slack_eligible: deriveSlackEligible(output),
    manual_review_required: output.needs_manual_review || output.route_type === "manual_review",
    summary: output.safe_slack_summary?.trim() || output.summary,
    recommended_next_step: output.recommended_next_step,
  };

  return { current, proposed, changes: changedFields(current, proposed), downgrade: isDowngrade(current, proposed) };
}

export async function previewReclassification(triageItemId: string) {
  return runPreviewClassifier(triageItemId);
}

export interface ApplyResult {
  applied: boolean;
  needsConfirmation?: boolean;
  reason?: string;
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
  triageItemId: string;
}

export async function applyReclassification(
  triageItemId: string,
  opts: { confirmDowngrade?: boolean; operator: OperatorProfilePublic }
): Promise<ApplyResult> {
  const preview = await runPreviewClassifier(triageItemId);

  // Do not silently downgrade sensitive/urgent content without explicit confirmation.
  if (preview.downgrade && !opts.confirmDowngrade) {
    return {
      applied: false,
      needsConfirmation: true,
      reason: "Reclassification would downgrade urgency or sensitivity — confirm to proceed.",
      changes: preview.changes,
      triageItemId,
    };
  }

  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);

  // Persist a new classification version (old preserved via is_current=false).
  const result = await classifyEmailById(item.inbound_email_id);

  // Update the existing canonical case in place — never create a duplicate.
  const updated = await triageRepo.updateClassificationSnapshot(triageItemId, {
    classificationId: result.classification.id,
    urgencyLevel: result.classification.urgency_level,
    sensitivityLevel: result.classification.sensitivity_level,
    routeType: result.routingRecommendation.route_type,
    owner: result.classification.recommended_owner ?? item.owner,
    summary: result.classification.summary,
    recommendedNextStep: result.classification.recommended_next_step,
  });

  await logEvent({
    inboundEmailId: item.inbound_email_id,
    classificationId: result.classification.id,
    eventType: "triage_reclassified",
    actorType: "human",
    actorId: opts.operator.username,
    action: `Reclassified triage item ${triageItemId} (by ${opts.operator.displayName ?? opts.operator.username})`,
    metadata: {
      changedFields: preview.changes.map(c => c.field),
      downgrade: preview.downgrade,
      model: result.classification.model_name,
      promptVersion: result.classification.prompt_version,
    },
  });

  // Update the existing Slack card — never post a second standalone message.
  await syncTriageItemToSlack(updated, `🔁 *Status:* Reclassified by ${opts.operator.displayName ?? opts.operator.username} (via dashboard)`).catch(() => {});

  return { applied: true, changes: preview.changes, triageItemId };
}
