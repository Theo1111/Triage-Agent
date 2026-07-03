import * as triageRepo from "@/src/repositories/triageItemsRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { canonicalOperator } from "@/src/config/operatorMap";
import { getCurrentClassification } from "@/src/services/classification";
import { getCurrentRoutingRecommendation } from "@/src/services/routingRecommendations";
import type {
  InboundEmail,
  EmailClassification,
  RoutingRecommendation,
  TriageItem,
} from "@/src/types/database";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TriageContext {
  email: InboundEmail;
  classification: EmailClassification;
  routingRecommendation: RoutingRecommendation | null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

// Primary: accepts pre-fetched data (used by slackAlerts to avoid duplicate DB reads).
// Returns null for "ignored" emails — not_relevant emails don't need triage records.
// The agent_audit_logs slack_post_blocked event is sufficient for those.
export async function createTriageItemFromContext(
  ctx: TriageContext,
  options: {
    slackAction: "posted" | "blocked" | "ignored";
    slackMessageTs?: string | null;
    slackChannel?: string | null;
  }
): Promise<TriageItem | null> {
  if (options.slackAction === "ignored") {
    console.log(
      `[triage] skipping triage item for not_relevant email: ${ctx.email.id}`
    );
    return null;
  }

  const status = options.slackAction === "posted" ? "new" : "manual_review";
  const rr = ctx.routingRecommendation;

  const item = await triageRepo.insert({
    inboundEmailId: ctx.email.id,
    classificationId: ctx.classification.id,
    routingRecommendationId: rr?.id ?? null,
    sourceInboxEmail: ctx.email.source_inbox_email,
    senderEmail: ctx.email.sender_email,
    senderName: ctx.email.sender_name,
    subject: ctx.email.subject,
    summary: ctx.classification.summary,
    urgencyLevel: ctx.classification.urgency_level,
    sensitivityLevel: ctx.classification.sensitivity_level,
    routeType: rr?.route_type ?? "manual_review",
    owner: ctx.classification.recommended_owner,
    status,
    recommendedNextStep: ctx.classification.recommended_next_step,
    slackMessageTs: options.slackMessageTs ?? null,
    slackChannel: options.slackChannel ?? null,
  });

  console.log(
    `[triage] created item=${item.id} email=${ctx.email.id} ` +
    `status=${status} urgency=${item.urgency_level} sensitivity=${item.sensitivity_level}`
  );

  return item;
}

// Convenience wrapper: fetches all required data then calls createTriageItemFromContext.
// Used by the test endpoint and any caller that doesn't already have the data loaded.
export async function createTriageItemFromClassification(input: {
  inboundEmailId: string;
  slackAction: "posted" | "blocked" | "ignored";
  slackMessageTs?: string | null;
  slackChannel?: string | null;
}): Promise<TriageItem | null> {
  const email = await inboundEmailsRepo.findById(input.inboundEmailId);
  if (!email) throw new Error(`Email not found: ${input.inboundEmailId}`);

  const classification = await getCurrentClassification(input.inboundEmailId);
  if (!classification) {
    throw new Error(
      `No current classification for email: ${input.inboundEmailId}. ` +
      `Run classify-email first.`
    );
  }

  const routingRecommendation = await getCurrentRoutingRecommendation(input.inboundEmailId);

  return createTriageItemFromContext(
    { email, classification, routingRecommendation },
    { slackAction: input.slackAction, slackMessageTs: input.slackMessageTs, slackChannel: input.slackChannel }
  );
}

// ─── Status transitions ──────────────────────────────────────────────────────

export async function assignTriageItem(
  triageItemId: string,
  owner: string
): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (item.status === "resolved") {
    throw new Error(`Cannot assign a resolved triage item: ${triageItemId}`);
  }

  // Normalize to canonical identity so Slack and dashboard assignments match.
  const canonicalOwner = canonicalOperator(owner) || owner;
  const updated = await triageRepo.assignItem(triageItemId, canonicalOwner);
  console.log(`[triage] assigned item=${triageItemId} owner=${canonicalOwner}`);
  return updated;
}

export async function resolveTriageItem(triageItemId: string): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (item.status === "resolved") {
    throw new Error(`Triage item already resolved: ${triageItemId}`);
  }

  const updated = await triageRepo.updateStatus(triageItemId, "resolved", {
    resolvedAt: new Date(),
  });
  console.log(`[triage] resolved item=${triageItemId}`);
  return updated;
}

export async function unassignTriageItem(
  triageItemId: string,
  requestingUsername: string
): Promise<{ item: TriageItem; ownershipError: string | null }> {
  const existing = await triageRepo.findById(triageItemId);
  if (!existing) throw new Error(`Triage item not found: ${triageItemId}`);
  // Guard on owner/assigned_at — escalated items can still have an owner assigned.
  // Checking status === "assigned" was wrong: escalated items have status "escalated"
  // even when they carry an owner.
  if (!existing.owner && !existing.assigned_at) {
    throw new Error(`Item is already unassigned: ${triageItemId}`);
  }
  const item = await triageRepo.unassignItem(triageItemId);
  console.log(`[triage] unassigned item=${triageItemId} by=${requestingUsername}`);
  return { item, ownershipError: null };
}

export async function unescalateTriageItem(triageItemId: string): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (!item.escalated_at && item.status !== "escalated") {
    throw new Error(`Triage item is not escalated: ${triageItemId}`);
  }
  const updated = await triageRepo.unescalateItem(triageItemId);
  console.log(`[triage] unescalated item=${triageItemId}`);
  return updated;
}

export async function reopenTriageItem(triageItemId: string): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (item.status !== "resolved") {
    throw new Error(`Cannot reopen a triage item that is not resolved: ${triageItemId}`);
  }

  const updated = await triageRepo.reopenItem(triageItemId);
  console.log(`[triage] reopened item=${triageItemId}`);
  return updated;
}

export async function archiveTriageItem(
  triageItemId: string,
  archivedBy: string,
  archivedReason?: string | null
): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (item.status === "archived") {
    throw new Error(`already_archived: Triage item is already archived: ${triageItemId}`);
  }

  const updated = await triageRepo.archiveItem(triageItemId, archivedBy, archivedReason);
  console.log(`[triage] archived item=${triageItemId} by=${archivedBy}`);
  return updated;
}

export async function unarchiveTriageItem(
  triageItemId: string,
  restoredBy: string
): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`item_not_found: Triage item not found: ${triageItemId}`);
  if (item.status !== "archived") {
    throw new Error(`not_archived: Triage item is not archived: ${triageItemId}`);
  }

  const updated = await triageRepo.unarchiveItem(triageItemId, restoredBy);
  console.log(`[triage] unarchived item=${triageItemId} by=${restoredBy} restored_status=${updated.status}`);
  return updated;
}

export async function touchTriageItem(triageItemId: string): Promise<TriageItem> {
  return triageRepo.touchUpdatedAt(triageItemId);
}

export async function updateTriageFields(
  triageItemId: string,
  fields: { owner?: string | null; summary?: string | null; recommendedNextStep?: string | null }
): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);

  const updated = await triageRepo.updateFields(triageItemId, fields);
  console.log(`[triage] updated fields for item=${triageItemId}`);
  return updated;
}

export async function escalateTriageItem(triageItemId: string): Promise<TriageItem> {
  const item = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);
  if (item.status === "resolved") {
    throw new Error(`Cannot escalate a resolved triage item: ${triageItemId}`);
  }

  const updated = await triageRepo.updateStatus(triageItemId, "escalated", {
    escalatedAt: new Date(),
  });
  console.log(`[triage] escalated item=${triageItemId}`);
  return updated;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function findOpenTriageItems(limit = 50): Promise<TriageItem[]> {
  return triageRepo.findOpen(limit);
}

export async function findByInboundEmailId(
  inboundEmailId: string
): Promise<TriageItem | null> {
  return triageRepo.findLatestByEmailId(inboundEmailId);
}
