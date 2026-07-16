import type { SerializedTriageItem, TabCounts } from "./types";

const CLOSED = ["resolved", "archived", "ignored"] as const;
const isOpen = (i: SerializedTriageItem) =>
  !(CLOSED as readonly string[]).includes(i.status);

// Derives tab counts from the items array using recommended_owner from the
// email_classifications JOIN — not primary_category, which describes what the
// issue is, not who should handle it.
export function computeCounts(items: SerializedTriageItem[]): TabCounts {
  return {
    all:              items.filter(isOpen).length,
    urgent_open:      items.filter(i => i.urgency_level === "urgent" && isOpen(i)).length,
    assigned:         items.filter(i => i.status === "assigned" || i.status === "escalated").length,
    manual_review:    items.filter(i => i.status === "manual_review").length,
    resolved:         items.filter(i => i.status === "resolved").length,
    archived:         items.filter(i => i.status === "archived").length,
    operations:       items.filter(i => isOpen(i) && i.recommended_owner === "operations").length,
    engineering:      items.filter(i => isOpen(i) && i.recommended_owner === "engineering").length,
    customer_success: items.filter(i => isOpen(i) && i.recommended_owner === "customer_success").length,
    field_ops:        items.filter(i => isOpen(i) && i.recommended_owner === "field_ops").length,
  };
}
