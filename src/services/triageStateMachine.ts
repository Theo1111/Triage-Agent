// Shared state-transition contract for triage cases. The dashboard handlers,
// Slack action handler, and bulk actions all derive "which actions are allowed"
// from THIS module so they cannot implement different rules. Assignment and
// escalation are tracked independently of status (see deriveTriageDisplayState),
// so this operates on the derived display state rather than the raw status.

import { deriveTriageDisplayState, type TriageDisplayInput } from "@/src/lib/triageDisplayState";

export type TriageAction =
  | "assign"
  | "unassign"
  | "escalate"
  | "unescalate"
  | "resolve"
  | "reopen"
  | "archive"
  | "restore";

export interface ActionCheck {
  ok: boolean;
  reason?: string;
}

// Actions that remove a case from the active queue — callers must confirm these.
export const REMOVES_FROM_ACTIVE: ReadonlySet<TriageAction> = new Set(["resolve", "archive"]);

export function allowedActions(item: TriageDisplayInput): TriageAction[] {
  const ds = deriveTriageDisplayState(item);
  const actions: TriageAction[] = [];

  if (ds.isActive) {
    actions.push(ds.isAssigned ? "unassign" : "assign");
    actions.push(ds.isEscalated ? "unescalate" : "escalate");
    actions.push("resolve");
    actions.push("archive");
  }
  if (ds.isResolved) {
    actions.push("reopen");
    actions.push("archive");
  }
  if (ds.isArchived) {
    actions.push("restore");
  }
  return actions;
}

export function canApply(action: TriageAction, item: TriageDisplayInput): ActionCheck {
  const allowed = allowedActions(item);
  if (allowed.includes(action)) return { ok: true };
  const ds = deriveTriageDisplayState(item);
  return {
    ok: false,
    reason: `Action "${action}" is not allowed for a case that is ${
      ds.isArchived ? "archived" : ds.isResolved ? "resolved" : "active"
    }.`,
  };
}
