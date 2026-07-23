// Builds a chronological activity timeline for one triage case.
//
// Source of truth is the existing agent_audit_logs table (reused, not
// duplicated). Where an older case predates audit logging, lifecycle events are
// backfilled from the triage item's own timestamps so historical cases still
// show a meaningful history. Email "received" events come from the thread's
// inbound_emails so every message in the thread appears.

import * as triageRepo from "@/src/repositories/triageItemsRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import * as auditRepo from "@/src/repositories/agentAuditLogsRepository";
import type { AgentAuditLog, InboundEmail, TriageItem } from "@/src/types/database";

export type TimelineActorType = "system" | "agent" | "human" | "slack" | "api" | "sender";

export interface TimelineEvent {
  id: string;
  at: string; // ISO
  category: string;
  actorType: TimelineActorType;
  actor: string;
  title: string;
  detail?: string;
}

export interface CaseMessage {
  inboundEmailId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  receivedAt: string | null;
  snippet: string | null;
}

export interface CaseTimeline {
  triageItemId: string;
  events: TimelineEvent[];
  messages: CaseMessage[];
  messageCount: number;
}

// Audit event_type → friendly timeline mapping. Types not listed are shown
// generically (category "other") using the row's own `action` text.
const EVENT_MAP: Record<string, { category: string; title: string }> = {
  classification_completed: { category: "classified", title: "AI classification completed" },
  classification_failed: { category: "classification_failed", title: "Classification failed" },
  slack_post_created: { category: "routed_slack", title: "Routed to Slack" },
  slack_post_failed: { category: "routed_slack_failed", title: "Slack delivery failed" },
  slack_post_blocked: { category: "routed_slack_blocked", title: "Slack post blocked (sensitive)" },
  triage_item_routed: { category: "routed_slack", title: "Routed via Slack" },
  triage_reopened_from_customer_reply: { category: "reopened", title: "Reopened from customer reply" },
  auto_resolved_from_reporter_reply: { category: "resolved", title: "Auto-resolved from reporter reply" },
  dashboard_owner_changed: { category: "assigned", title: "Assigned" },
  dashboard_item_unassigned: { category: "unassigned", title: "Unassigned" },
  dashboard_item_escalated: { category: "escalated", title: "Escalated" },
  dashboard_item_unescalated: { category: "unescalated", title: "Unescalated" },
  dashboard_item_resolved: { category: "resolved", title: "Resolved" },
  dashboard_item_reopened: { category: "reopened", title: "Reopened" },
  dashboard_item_archived: { category: "archived", title: "Archived" },
  dashboard_item_unarchived: { category: "restored", title: "Restored" },
  dashboard_fields_updated: { category: "summary_edited", title: "Details edited" },
  triage_assigned_from_slack: { category: "assigned", title: "Assigned via Slack" },
  triage_resolved_from_slack: { category: "resolved", title: "Resolved via Slack" },
  triage_reopened_from_slack: { category: "reopened", title: "Reopened via Slack" },
  triage_item_unassigned: { category: "unassigned", title: "Unassigned via Slack" },
};

// Audit event_types we intentionally omit from the case timeline (internal /
// noisy / already represented by synthesized email + lifecycle events).
const OMIT_EVENTS = new Set([
  "classification_started",
  "sensitivity_decision_saved",
  "routing_recommendation_saved",
  "slack_post_eligible",
  "auto_triage_started",
  "auto_triage_completed",
  "auto_triage_skipped",
  "thread_reply_received",
  "duplicate_thread_update_linked",
  "reply_suppressed_customer_acknowledgement",
  "reply_suppressed_internal_coordination",
  "reply_suppressed_as_acknowledgement",
]);

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function actorLabelFor(row: AgentAuditLog): { actorType: TimelineActorType; actor: string } {
  switch (row.actor_type) {
    case "human":
      return { actorType: "human", actor: row.actor_id || "Operator" };
    case "slack":
      return { actorType: "slack", actor: row.actor_id ? `Slack (${row.actor_id})` : "Slack" };
    case "agent":
      return { actorType: "agent", actor: "Triage agent" };
    case "api":
      return { actorType: "api", actor: "API" };
    default:
      return { actorType: "system", actor: "System" };
  }
}

function senderLabel(email: InboundEmail): string {
  if (email.sender_name && email.sender_email) return `${email.sender_name} <${email.sender_email}>`;
  return email.sender_name || email.sender_email || "Unknown sender";
}

export async function buildCaseTimeline(triageItemId: string): Promise<CaseTimeline> {
  const item: TriageItem | null = await triageRepo.findById(triageItemId);
  if (!item) throw new Error(`Triage item not found: ${triageItemId}`);

  // Gather every email in the case's Gmail thread. Prefer the denormalized
  // thread id on the case; if it hasn't been backfilled yet (pre-migration),
  // fall back to the linked email's own thread id so thread grouping still works.
  let emails: InboundEmail[] = [];
  let threadId = item.gmail_thread_id;
  const single = await inboundEmailsRepo.findById(item.inbound_email_id);
  if (!threadId && single?.gmail_thread_id) threadId = single.gmail_thread_id;
  if (threadId) {
    emails = await inboundEmailsRepo.findByThreadId(threadId);
  }
  if (emails.length === 0 && single) {
    emails = [single];
  }
  const emailIds = emails.map(e => e.id);
  if (!emailIds.includes(item.inbound_email_id)) emailIds.push(item.inbound_email_id);

  const auditRows = await auditRepo.findByEmailIdsAsc(emailIds);

  const events: TimelineEvent[] = [];

  // 1. Email received / reply received (one per thread message, oldest first).
  emails
    .slice()
    .sort(
      (a, b) =>
        new Date(a.received_at ?? a.created_at).getTime() -
        new Date(b.received_at ?? b.created_at).getTime()
    )
    .forEach((email, idx) => {
      const at = toIso(email.received_at ?? email.created_at);
      if (!at) return;
      events.push({
        id: `email:${email.id}`,
        at,
        category: idx === 0 ? "email_received" : "reply_received",
        actorType: "sender",
        actor: senderLabel(email),
        title: idx === 0 ? "Initial email received" : "Reply received",
        detail: email.subject ?? undefined,
      });
    });

  // 2. Audit-log events (the authoritative record of actions).
  const seenCategories = new Set<string>();
  for (const row of auditRows) {
    if (OMIT_EVENTS.has(row.event_type)) continue;
    const mapped = EVENT_MAP[row.event_type];
    const { actorType, actor } = actorLabelFor(row);
    const at = toIso(row.created_at);
    if (!at) continue;

    const category = mapped?.category ?? "other";
    const title = mapped?.title ?? row.action;
    let detail: string | undefined = row.reason ?? undefined;
    // Enrich a couple of common cases with the affected owner.
    if (category === "assigned") {
      const owner =
        (row.after_state as { owner?: string } | null)?.owner ?? undefined;
      if (owner) detail = `Owner set to ${owner}`;
    }
    seenCategories.add(category);
    events.push({
      id: `audit:${row.id}`,
      at,
      category,
      actorType,
      actor,
      title,
      detail,
    });
  }

  // 3. Backfill lifecycle events from timestamps when audit rows are absent
  //    (cases created before audit logging, or actions taken outside it).
  const backfill: Array<{ ts: Date | null; category: string; title: string }> = [
    { ts: item.created_at, category: "created", title: "Case created" },
    { ts: item.assigned_at, category: "assigned", title: "Assigned" },
    { ts: item.escalated_at, category: "escalated", title: "Escalated" },
    { ts: item.resolved_at, category: "resolved", title: "Resolved" },
    { ts: item.archived_at, category: "archived", title: "Archived" },
    { ts: item.restored_at, category: "restored", title: "Restored" },
  ];
  for (const b of backfill) {
    const at = toIso(b.ts);
    if (!at) continue;
    if (b.category !== "created" && seenCategories.has(b.category)) continue;
    events.push({
      id: `ts:${b.category}:${at}`,
      at,
      category: b.category,
      actorType: "system",
      actor: "System",
      title: b.title,
      detail:
        b.category === "archived" && item.archived_by
          ? `by ${item.archived_by}${item.archived_reason ? ` — ${item.archived_reason}` : ""}`
          : b.category === "restored" && item.restored_by
          ? `by ${item.restored_by}`
          : undefined,
    });
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const messages: CaseMessage[] = emails
    .slice()
    .sort(
      (a, b) =>
        new Date(a.received_at ?? a.created_at).getTime() -
        new Date(b.received_at ?? b.created_at).getTime()
    )
    .map(e => ({
      inboundEmailId: e.id,
      subject: e.subject,
      senderName: e.sender_name,
      senderEmail: e.sender_email,
      receivedAt: toIso(e.received_at ?? e.created_at),
      snippet: e.snippet,
    }));

  return { triageItemId, events, messages, messageCount: emails.length };
}
