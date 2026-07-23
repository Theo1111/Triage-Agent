// TypeScript types matching the database schema in 001_email_ingestion.sql.

export interface MonitoredInbox {
  id: string;
  display_name: string;
  email_address: string;
  provider: string;
  auth_type: string;
  team_area: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OauthAccount {
  id: string;
  monitored_inbox_id: string;
  provider: string;
  provider_account_email: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type WatchStatus = "active" | "expired" | "renewal_failed" | "stopped" | "unknown" | "oauth_invalid";

export interface GmailWatchState {
  id: string;
  monitored_inbox_id: string;
  email_address: string;
  topic_name: string;
  current_history_id: string | null;
  last_processed_history_id: string | null;
  watch_expiration: Date | null;
  watch_status: WatchStatus;
  last_watch_started_at: Date | null;
  last_notification_at: Date | null;
  last_successful_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type PubSubNotificationStatus = "received" | "processing" | "processed" | "duplicate" | "failed";

export interface PubSubNotification {
  id: string;
  pubsub_message_id: string;
  email_address: string | null;
  history_id: string | null;
  raw_payload: Record<string, unknown>;
  received_at: Date;
  processed_at: Date | null;
  status: PubSubNotificationStatus;
  error_message: string | null;
  created_at: Date;
}

export type IngestionRunTrigger = "pubsub_push" | "manual_rerun" | "manual_backfill" | "daily_watch_renewal" | "fallback_sync";
export type IngestionRunStatus = "started" | "success" | "partial_success" | "failed";

export interface IngestionRun {
  id: string;
  run_id: string;
  trigger_type: IngestionRunTrigger;
  trigger_source: string | null;
  started_at: Date;
  finished_at: Date | null;
  status: IngestionRunStatus;
  inboxes_checked: number;
  messages_found: number;
  new_messages_stored: number;
  duplicates_skipped: number;
  external_messages_skipped: number;
  automated_alerts_skipped: number;
  attachments_found: number;
  attachments_stored: number;
  attachment_parse_failures: number;
  errors: number;
  created_at: Date;
}

export type IngestionStatus =
  | "stored"
  | "skipped_internal"
  | "skipped_automated_alert"
  | "duplicate_skipped"
  | "parse_failed"
  | "attachment_partial_failure"
  | "ready_for_classification";

export type ProcessingStatus = "awaiting_classification" | "classification_ready" | "classification_failed";

export interface InboundEmail {
  id: string;
  monitored_inbox_id: string;
  source_inbox_email: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  gmail_history_id: string | null;
  gmail_internal_date: string | null;
  gmail_link: string | null;
  label_ids: string[] | null;
  sender_email: string | null;
  sender_name: string | null;
  recipient_emails: string[] | null;
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  reply_to: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_mime: string | null;
  headers_json: Record<string, string> | null;
  payload_json: Record<string, unknown> | null;
  size_estimate: number | null;
  received_at: Date | null;
  sent_at: Date | null;
  is_external: boolean | null;
  is_automated_alert: boolean | null;
  has_attachments: boolean;
  attachment_count: number;
  ingestion_status: IngestionStatus;
  processing_status: ProcessingStatus;
  created_at: Date;
  updated_at: Date;
}

export type ContentExtractionStatus = "not_attempted" | "extracted" | "unsupported" | "failed";

export interface EmailAttachment {
  id: string;
  inbound_email_id: string;
  gmail_attachment_id: string;
  filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  is_inline: boolean;
  content_id: string | null;
  content_disposition: string | null;
  content_text: string | null;
  content_extraction_status: ContentExtractionStatus;
  content_extraction_error: string | null;
  created_at: Date;
  updated_at: Date;
}

// --- Classification / routing tables (002_classification_routing.sql) ---

export type ClassificationRunStatus = "started" | "success" | "partial_success" | "failed";

export interface ClassificationRun {
  id: string;
  run_id: string;
  inbound_email_id: string;
  trigger_type: string;
  status: ClassificationRunStatus;
  model_name: string | null;
  prompt_version: string | null;
  started_at: Date;
  finished_at: Date | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export type UrgencyLevel = "urgent" | "normal" | "not_relevant" | "unknown";
export type SensitivityLevel = "public_internal" | "private" | "sensitive" | "unknown";

export interface EmailClassification {
  id: string;
  inbound_email_id: string;
  classification_run_id: string | null;
  urgency_level: UrgencyLevel;
  sensitivity_level: SensitivityLevel;
  primary_category: string | null;
  category_tags: string[];
  summary: string | null;
  urgency_reason: string | null;
  sensitivity_reason: string | null;
  recommended_owner: string | null;
  recommended_next_step: string | null;
  confidence_score: number | null;
  model_name: string | null;
  prompt_version: string | null;
  is_current: boolean;
  classified_at: Date;
  created_at: Date;
  updated_at: Date;
}

export type SensitivityReviewStatus =
  | "system_decision"
  | "needs_human_review"
  | "human_approved"
  | "human_overridden";

export interface SensitivityReview {
  id: string;
  inbound_email_id: string;
  classification_id: string | null;
  is_sensitive: boolean;
  sensitivity_categories: string[];
  shared_slack_allowed: boolean;
  private_route_required: boolean;
  reason: string | null;
  review_status: SensitivityReviewStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type RouteType =
  | "slack_channel"
  | "private_owner"
  | "dashboard_only"
  | "ignore"
  | "manual_review";

export interface RoutingRecommendation {
  id: string;
  inbound_email_id: string;
  classification_id: string | null;
  route_type: RouteType;
  target_owner: string | null;
  target_owner_email: string | null;
  target_channel: string | null;
  recommended_action: string | null;
  route_reason: string | null;
  is_current: boolean;
  created_at: Date;
  updated_at: Date;
}

export type ActorType = "system" | "agent" | "human" | "slack" | "api";

export interface AgentAuditLog {
  id: string;
  inbound_email_id: string | null;
  classification_run_id: string | null;
  classification_id: string | null;
  event_type: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// --- Triage / escalation tracking (003_triage_items.sql) ---

export type TriageStatus =
  | "new"
  | "assigned"
  | "escalated"
  | "resolved"
  | "ignored"
  | "manual_review"
  | "archived";

export interface TriageItem {
  id: string;
  inbound_email_id: string;
  classification_id: string | null;
  routing_recommendation_id: string | null;
  source_inbox_email: string;
  sender_email: string | null;
  sender_name: string | null;
  subject: string | null;
  summary: string | null;
  urgency_level: UrgencyLevel;
  sensitivity_level: SensitivityLevel;
  route_type: RouteType;
  owner: string | null;
  status: TriageStatus;
  recommended_next_step: string | null;
  slack_message_ts: string | null;
  slack_channel: string | null;
  created_at: Date;
  updated_at: Date;
  assigned_at: Date | null;
  resolved_at: Date | null;
  escalated_at: Date | null;
  archived_at: Date | null;
  archived_by: string | null;
  archived_reason: string | null;
  restored_at: Date | null;
  restored_by: string | null;
  // Migration 008 — one case per Gmail thread.
  gmail_thread_id: string | null;
  superseded_by_triage_item_id: string | null;
}

export type ErrorStage =
  | "oauth_failed"
  | "watch_failed"
  | "pubsub_decode_failed"
  | "pubsub_duplicate_detected"
  | "history_fetch_failed"
  | "message_fetch_failed"
  | "message_parse_failed"
  | "attachment_fetch_failed"
  | "attachment_store_failed"
  | "attachment_parse_failed"
  | "database_insert_failed"
  | "duplicate_detected"
  | "external_filter_failed"
  | "automated_alert_filter_failed"
  | "unknown";

export interface IngestionError {
  id: string;
  ingestion_run_id: string | null;
  monitored_inbox_id: string | null;
  inbound_email_id: string | null;
  gmail_message_id: string | null;
  error_stage: ErrorStage;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  is_resolved: boolean;
  created_at: Date;
  updated_at: Date;
}
