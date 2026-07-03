// Shared helper — derives display state from triage item fields.
// Used by dashboard components and Slack card rendering so they cannot disagree.
//
// Assignment state comes from owner/assigned_at (not status alone).
// Escalation state comes from escalated_at (not status alone).
// This decouples the two so a single "status" column never has to encode both.

export interface TriageDisplayInput {
  status: string;
  owner: string | null;
  assigned_at: string | Date | null;
  escalated_at: string | Date | null;
}

export interface TriageDisplayState {
  isAssigned: boolean;
  isEscalated: boolean;
  isResolved: boolean;
  isArchived: boolean;
  isActive: boolean;
}

export function deriveTriageDisplayState(item: TriageDisplayInput): TriageDisplayState {
  const isResolved = item.status === "resolved";
  const isArchived = item.status === "archived";
  const isActive   = !isResolved && !isArchived;
  const isAssigned = (item.owner != null && item.owner !== "") || item.assigned_at != null;
  const isEscalated = item.escalated_at != null || item.status === "escalated";
  return { isAssigned, isEscalated, isResolved, isArchived, isActive };
}
