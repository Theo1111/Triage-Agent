// Service-level targets for first response, derived purely from existing data
// (a case's urgency_level and created_at). No schema change required.
//
// A case "breaches SLA" when it is still active (not resolved/archived/ignored)
// and its age has passed the target for its urgency. These are response targets,
// not contractual guarantees — they exist to surface aging work.

export const SLA_TARGET_MS: Record<string, number> = {
  urgent: 4 * 60 * 60 * 1000, //  4 hours
  normal: 24 * 60 * 60 * 1000, // 24 hours
};

// Urgency levels with no defined target (not_relevant, unknown) never breach.
export function slaTargetMs(urgencyLevel: string): number | null {
  return SLA_TARGET_MS[urgencyLevel] ?? null;
}

const CLOSED_STATUSES = new Set(["resolved", "archived", "ignored"]);

export interface SlaInput {
  status: string;
  urgency_level: string;
  created_at: string; // ISO
}

// Absolute deadline (ms epoch) or null when this urgency has no target.
export function slaDeadlineMs(item: SlaInput): number | null {
  const target = slaTargetMs(item.urgency_level);
  if (target == null) return null;
  return new Date(item.created_at).getTime() + target;
}

export function isSlaBreached(item: SlaInput, now = Date.now()): boolean {
  if (CLOSED_STATUSES.has(item.status)) return false;
  const deadline = slaDeadlineMs(item);
  if (deadline == null) return false;
  return now > deadline;
}
