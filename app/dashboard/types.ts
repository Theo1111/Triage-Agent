// Plain serializable form of TriageItem (with classification join fields).
// Dates as ISO strings so it can cross the server → client boundary.
export interface SerializedTriageItem {
  id: string;
  inbound_email_id: string;
  classification_id: string | null;
  source_inbox_email: string;
  sender_email: string | null;
  sender_name: string | null;
  subject: string | null;
  summary: string | null;
  urgency_level: string;
  sensitivity_level: string;
  route_type: string;
  owner: string | null;
  status: string;
  recommended_next_step: string | null;
  slack_channel: string | null;
  slack_message_ts: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  resolved_at: string | null;
  escalated_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  // From email_classifications JOIN
  primary_category: string | null;
  urgency_reason: string | null;
}

export interface TabCounts {
  all: number;
  urgent_open: number;
  assigned: number;
  manual_review: number;
  operations: number;
  engineering: number;
  customer_success: number;
  field_ops: number;
  resolved: number;
  archived: number;
}
