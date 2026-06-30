import { query, queryOne } from "@/src/lib/db";
import type { AgentAuditLog, ActorType } from "@/src/types/database";

export interface InsertAuditLogInput {
  inboundEmailId?: string | null;
  classificationRunId?: string | null;
  classificationId?: string | null;
  eventType: string;
  actorType?: ActorType;
  actorId?: string | null;
  action: string;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export async function insert(input: InsertAuditLogInput): Promise<AgentAuditLog> {
  const row = await queryOne<AgentAuditLog>(
    `INSERT INTO agent_audit_logs (
       inbound_email_id, classification_run_id, classification_id,
       event_type, actor_type, actor_id,
       action, reason,
       before_state, after_state, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      input.inboundEmailId ?? null,
      input.classificationRunId ?? null,
      input.classificationId ?? null,
      input.eventType,
      input.actorType ?? "system",
      input.actorId ?? null,
      input.action,
      input.reason ?? null,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
  if (!row) throw new Error("Failed to insert agent_audit_log");
  return row;
}

export async function findByEmailId(
  inboundEmailId: string,
  limit = 100
): Promise<AgentAuditLog[]> {
  return query<AgentAuditLog>(
    `SELECT * FROM agent_audit_logs
     WHERE inbound_email_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [inboundEmailId, limit]
  );
}
