import { query, queryOne } from "@/src/lib/db";
import type { TriageItem, TriageStatus } from "@/src/types/database";

export interface InsertTriageItemInput {
  inboundEmailId: string;
  classificationId?: string | null;
  routingRecommendationId?: string | null;
  sourceInboxEmail: string;
  senderEmail?: string | null;
  senderName?: string | null;
  subject?: string | null;
  summary?: string | null;
  urgencyLevel: string;
  sensitivityLevel: string;
  routeType: string;
  owner?: string | null;
  status: TriageStatus;
  recommendedNextStep?: string | null;
  slackMessageTs?: string | null;
  slackChannel?: string | null;
  // Denormalized Gmail thread id (migration 008) — lets the queue collapse a
  // thread to one case and lets the drawer gather every message in the thread.
  gmailThreadId?: string | null;
}

export async function insert(input: InsertTriageItemInput): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `INSERT INTO triage_items (
       inbound_email_id, classification_id, routing_recommendation_id,
       source_inbox_email, sender_email, sender_name,
       subject, summary, urgency_level, sensitivity_level,
       route_type, owner, status, recommended_next_step,
       slack_message_ts, slack_channel, gmail_thread_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      input.inboundEmailId,
      input.classificationId ?? null,
      input.routingRecommendationId ?? null,
      input.sourceInboxEmail,
      input.senderEmail ?? null,
      input.senderName ?? null,
      input.subject ?? null,
      input.summary ?? null,
      input.urgencyLevel,
      input.sensitivityLevel,
      input.routeType,
      input.owner ?? null,
      input.status,
      input.recommendedNextStep ?? null,
      input.slackMessageTs ?? null,
      input.slackChannel ?? null,
      input.gmailThreadId ?? null,
    ]
  );
  if (!row) throw new Error(`Failed to insert triage item for email ${input.inboundEmailId}`);
  return row;
}

export async function findById(id: string): Promise<TriageItem | null> {
  return queryOne<TriageItem>("SELECT * FROM triage_items WHERE id = $1", [id]);
}

export async function findLatestByEmailId(inboundEmailId: string): Promise<TriageItem | null> {
  return queryOne<TriageItem>(
    `SELECT * FROM triage_items
     WHERE inbound_email_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [inboundEmailId]
  );
}

// Find the most recent open triage item for a Gmail thread (excluding the current email).
// Used to link replies to existing triage items and to suppress duplicate Slack alerts.
export async function findOpenByThreadId(
  gmailThreadId: string,
  excludeEmailId: string
): Promise<TriageItem | null> {
  return queryOne<TriageItem>(
    `SELECT ti.* FROM triage_items ti
     JOIN inbound_emails ie ON ie.id = ti.inbound_email_id
     WHERE ie.gmail_thread_id = $1
       AND ie.id != $2
       AND ti.status NOT IN ('archived', 'ignored')
     ORDER BY ti.created_at DESC
     LIMIT 1`,
    [gmailThreadId, excludeEmailId]
  );
}

// Count active (non-superseded) triage items in a given status — used by the
// health panel (e.g. manual-review backlog).
export async function countByStatus(status: TriageStatus): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM triage_items
     WHERE status = $1 AND superseded_by_triage_item_id IS NULL`,
    [status]
  );
  return Number(row?.count ?? 0);
}

export async function findOpen(limit = 50): Promise<TriageItem[]> {
  return query<TriageItem>(
    `SELECT * FROM triage_items
     WHERE status NOT IN ('resolved', 'ignored')
     ORDER BY
       CASE urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $1`,
    [limit]
  );
}

// Used for assign: updates owner and sets assigned_at.
// Preserves "escalated" status when the item is currently escalated — escalation
// and assignment are tracked independently via escalated_at and owner/assigned_at.
export async function assignItem(
  id: string,
  owner: string
): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET owner       = $2,
         assigned_at = now(),
         status      = CASE WHEN escalated_at IS NOT NULL THEN 'escalated' ELSE 'assigned' END,
         updated_at  = now()
     WHERE id = $1
     RETURNING *`,
    [id, owner]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Unassign: clears owner + assigned_at.
// Restores "escalated" status when the item is still escalated, otherwise "new".
export async function unassignItem(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET owner       = NULL,
         assigned_at = NULL,
         status      = CASE WHEN escalated_at IS NOT NULL THEN 'escalated' ELSE 'new' END,
         updated_at  = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Unescalate: clears escalated_at and restores status based on whether an owner is set.
export async function unescalateItem(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET escalated_at = NULL,
         status       = CASE WHEN owner IS NOT NULL THEN 'assigned' ELSE 'new' END,
         updated_at   = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Reopen a resolved item — resets status to "new" and clears resolved_at.
export async function reopenItem(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET status      = 'new',
         resolved_at = NULL,
         updated_at  = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Reopen a resolved item as escalated, triggered by a customer reply indicating
// the issue has recurred. Clears resolved_at, sets escalated_at to now().
// Preserves: created_at, inbound_email_id, slack_channel, slack_message_ts, owner.
export async function reopenResolvedAsEscalated(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET status       = 'escalated',
         resolved_at  = NULL,
         escalated_at = now(),
         updated_at   = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Archive: sets status to "archived" and records who/when/why.
export async function archiveItem(
  id: string,
  archivedBy: string,
  archivedReason?: string | null
): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET status          = 'archived',
         archived_at     = now(),
         archived_by     = $2,
         archived_reason = $3,
         updated_at      = now()
     WHERE id = $1
     RETURNING *`,
    [id, archivedBy, archivedReason ?? null]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Unarchive / restore: clears archive fields, sets restored tracking, and
// infers the previous status from timestamps (resolved_at → resolved,
// escalated_at → escalated, assigned_at + owner → assigned, else new).
export async function unarchiveItem(id: string, restoredBy: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET archived_at     = NULL,
         archived_by     = NULL,
         archived_reason = NULL,
         restored_at     = now(),
         restored_by     = $2,
         status          = CASE
           WHEN resolved_at   IS NOT NULL THEN 'resolved'
           WHEN escalated_at  IS NOT NULL THEN 'escalated'
           WHEN assigned_at   IS NOT NULL AND owner IS NOT NULL THEN 'assigned'
           ELSE 'new'
         END,
         updated_at      = now()
     WHERE id = $1
     RETURNING *`,
    [id, restoredBy]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Touch updated_at — used when a customer reply is linked to an existing issue
// without any status change (the reply is informational rather than escalating).
export async function touchUpdatedAt(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items SET updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Patch a subset of mutable triage fields. Only non-null values in the input are updated.
export async function updateFields(
  id: string,
  fields: { owner?: string | null; summary?: string | null; recommendedNextStep?: string | null }
): Promise<TriageItem> {
  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [id];
  let idx = 2;

  if ("owner" in fields) {
    setClauses.push(`owner = $${idx++}`);
    values.push(fields.owner ?? null);
  }
  if ("summary" in fields) {
    setClauses.push(`summary = $${idx++}`);
    values.push(fields.summary ?? null);
  }
  if ("recommendedNextStep" in fields) {
    setClauses.push(`recommended_next_step = $${idx++}`);
    values.push(fields.recommendedNextStep ?? null);
  }

  const row = await queryOne<TriageItem>(
    `UPDATE triage_items SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    values
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Used for resolve/escalate: sets status and the corresponding timestamp.
export async function updateStatus(
  id: string,
  status: TriageStatus,
  timestamps: {
    resolvedAt?: Date | null;
    escalatedAt?: Date | null;
  }
): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET status       = $2,
         resolved_at  = COALESCE($3, resolved_at),
         escalated_at = COALESCE($4, escalated_at),
         updated_at   = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      timestamps.resolvedAt ?? null,
      timestamps.escalatedAt ?? null,
    ]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}
