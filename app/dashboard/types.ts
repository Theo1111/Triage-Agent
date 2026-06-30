// Plain serializable form of TriageItem — dates as ISO strings so it can
// cross the server-component → client-component boundary without throwing.
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
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  resolved_at: string | null;
  escalated_at: string | null;
}
