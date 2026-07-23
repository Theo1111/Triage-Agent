import type { SerializedTriageItem, TabCounts } from "./types";
import { isSlaBreached } from "@/src/config/sla";

const CLOSED = ["resolved", "archived", "ignored"] as const;
const isOpen = (i: SerializedTriageItem) =>
  !(CLOSED as readonly string[]).includes(i.status);

const isAssigned = (i: SerializedTriageItem) =>
  (i.owner != null && i.owner !== "") || i.assigned_at != null;
const isEscalated = (i: SerializedTriageItem) =>
  i.escalated_at != null || i.status === "escalated";

export interface CountOptions {
  // Predicate that identifies the current operator's cases (for My Queue).
  matchesMe?: (i: SerializedTriageItem) => boolean;
}

// Derives tab counts from the items array using recommended_owner from the
// email_classifications JOIN for team buckets, plus status/ownership/SLA for the
// work views. Superseded thread duplicates are already excluded upstream.
export function computeCounts(
  items: SerializedTriageItem[],
  opts: CountOptions = {}
): TabCounts {
  const matchesMe = opts.matchesMe ?? (() => false);
  return {
    all:              items.filter(isOpen).length,
    my_queue:         items.filter(i => isOpen(i) && matchesMe(i)).length,
    unassigned:       items.filter(i => isOpen(i) && !isAssigned(i)).length,
    urgent_open:      items.filter(i => i.urgency_level === "urgent" && isOpen(i)).length,
    escalated:        items.filter(i => isOpen(i) && isEscalated(i)).length,
    assigned:         items.filter(i => i.status === "assigned" || i.status === "escalated").length,
    manual_review:    items.filter(i => i.status === "manual_review").length,
    resolved:         items.filter(i => i.status === "resolved").length,
    archived:         items.filter(i => i.status === "archived").length,
    operations:       items.filter(i => isOpen(i) && i.recommended_owner === "operations").length,
    engineering:      items.filter(i => isOpen(i) && i.recommended_owner === "engineering").length,
    customer_success: items.filter(i => isOpen(i) && i.recommended_owner === "customer_success").length,
    field_ops:        items.filter(i => isOpen(i) && i.recommended_owner === "field_ops").length,
    sla_breached:     items.filter(i => isSlaBreached(i)).length,
  };
}
