import * as auditRepo from "@/src/repositories/agentAuditLogsRepository";
import type { ActorType } from "@/src/types/database";

export interface LogEventInput {
  inboundEmailId?: string | null;
  classificationRunId?: string | null;
  classificationId?: string | null;
  eventType: string;
  action: string;
  actorType?: ActorType;
  actorId?: string | null;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

// Write an audit log entry. Never throws — a failed audit write must not
// crash the pipeline that triggered it.
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await auditRepo.insert({
      inboundEmailId: input.inboundEmailId ?? null,
      classificationRunId: input.classificationRunId ?? null,
      classificationId: input.classificationId ?? null,
      eventType: input.eventType,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}
