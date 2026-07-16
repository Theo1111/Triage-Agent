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
  archived_reason: string | null;
  restored_at: string | null;
  restored_by: string | null;
  // From email_classifications JOIN
  primary_category: string | null;
  urgency_reason: string | null;
  recommended_owner: string | null;
  // Per-operator read state: true when updated_at > operator's last_viewed_at
  has_unread_update: boolean;
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

export type DashboardView = "queue" | "agent";

/** One triage-agent classification run, joined to email + current classification. */
export interface SerializedAgentRun {
  id: string;
  run_id: string;
  inbound_email_id: string;
  status: string;
  model_name: string | null;
  prompt_version: string | null;
  started_at: string;
  finished_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  source_inbox_email: string | null;
  snippet: string | null;
  classification_id: string | null;
  urgency_level: string | null;
  sensitivity_level: string | null;
  primary_category: string | null;
  category_tags: string[];
  summary: string | null;
  urgency_reason: string | null;
  sensitivity_reason: string | null;
  recommended_owner: string | null;
  recommended_next_step: string | null;
  confidence_score: number | null;
  route_type: string | null;
  triage_item_id: string | null;
  triage_status: string | null;
  // Diagnostics from classification_runs.raw_response
  operational_impact_detected: boolean | null;
  needs_manual_review: boolean | null;
  impact_reasoning: string | null;
  matched_vocabulary_terms: string[];
  human_language_signals: string[];
  safe_slack_summary: string | null;
}
