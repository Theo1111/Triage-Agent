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
}

export async function insert(input: InsertTriageItemInput): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `INSERT INTO triage_items (
       inbound_email_id, classification_id, routing_recommendation_id,
       source_inbox_email, sender_email, sender_name,
       subject, summary, urgency_level, sensitivity_level,
       route_type, owner, status, recommended_next_step,
       slack_message_ts, slack_channel
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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

// Used for assign: updates owner, status, and sets assigned_at = now().
export async function assignItem(
  id: string,
  owner: string
): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET owner = $2, status = 'assigned', assigned_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, owner]
  );
  if (!row) throw new Error(`Triage item not found: ${id}`);
  return row;
}

// Unassign: clears owner + assigned_at, resets status to "new".
export async function unassignItem(id: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET owner       = NULL,
         assigned_at = NULL,
         status      = 'new',
         updated_at  = now()
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

// Archive: sets status to "archived" and records who/when.
export async function archiveItem(id: string, archivedBy: string): Promise<TriageItem> {
  const row = await queryOne<TriageItem>(
    `UPDATE triage_items
     SET status      = 'archived',
         archived_at = now(),
         archived_by = $2,
         updated_at  = now()
     WHERE id = $1
     RETURNING *`,
    [id, archivedBy]
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
