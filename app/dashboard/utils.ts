import { TEAM_CATEGORIES } from "@/src/config/roles";
import type { SerializedTriageItem, TabCounts } from "./types";

const CLOSED = ["resolved", "archived", "ignored"] as const;
const isOpen = (i: SerializedTriageItem) =>
  !(CLOSED as readonly string[]).includes(i.status);

// Derives tab counts from the items array — no DB query needed since
// fetchAllItems already JOINs email_classifications for primary_category.
export function computeCounts(items: SerializedTriageItem[]): TabCounts {
  return {
    all:              items.filter(isOpen).length,
    urgent_open:      items.filter(i => i.urgency_level === "urgent" && isOpen(i)).length,
    assigned:         items.filter(i => i.status === "assigned" || i.status === "escalated").length,
    manual_review:    items.filter(i => i.status === "manual_review").length,
    resolved:         items.filter(i => i.status === "resolved").length,
    archived:         items.filter(i => i.status === "archived").length,
    operations:       items.filter(i => isOpen(i) && i.primary_category != null && TEAM_CATEGORIES.operations.includes(i.primary_category)).length,
    engineering:      items.filter(i => isOpen(i) && i.primary_category != null && TEAM_CATEGORIES.engineering.includes(i.primary_category)).length,
    customer_success: items.filter(i => isOpen(i) && i.primary_category != null && TEAM_CATEGORIES.customer_success.includes(i.primary_category)).length,
    field_ops:        items.filter(i => isOpen(i) && i.primary_category != null && TEAM_CATEGORIES.field_ops.includes(i.primary_category)).length,
  };
}
