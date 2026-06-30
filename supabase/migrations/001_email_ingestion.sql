-- 001_email_ingestion.sql
-- Initial database model for Email Ingestion V1.
-- Target: Supabase/Postgres.

create extension if not exists "pgcrypto";

create table if not exists monitored_inboxes (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email_address text not null unique,
  provider text not null default 'gmail',
  auth_type text not null default 'oauth',
  team_area text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  monitored_inbox_id uuid not null references monitored_inboxes(id) on delete cascade,
  provider text not null default 'google',
  provider_account_email text not null,
  access_token text,
  refresh_token text,
  scope text,
  token_type text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(monitored_inbox_id, provider)
);

create table if not exists gmail_watch_states (
  id uuid primary key default gen_random_uuid(),
  monitored_inbox_id uuid not null references monitored_inboxes(id) on delete cascade,
  email_address text not null,
  topic_name text not null,
  current_history_id text,
  last_processed_history_id text,
  watch_expiration timestamptz,
  watch_status text not null default 'unknown',
  last_watch_started_at timestamptz,
  last_notification_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(monitored_inbox_id)
);

create table if not exists pubsub_notifications (
  id uuid primary key default gen_random_uuid(),
  pubsub_message_id text not null unique,
  email_address text,
  history_id text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  trigger_type text not null,
  trigger_source text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'started',
  inboxes_checked integer not null default 0,
  messages_found integer not null default 0,
  new_messages_stored integer not null default 0,
  duplicates_skipped integer not null default 0,
  external_messages_skipped integer not null default 0,
  automated_alerts_skipped integer not null default 0,
  attachments_found integer not null default 0,
  attachments_stored integer not null default 0,
  attachment_parse_failures integer not null default 0,
  errors integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists inbound_emails (
  id uuid primary key default gen_random_uuid(),
  monitored_inbox_id uuid not null references monitored_inboxes(id) on delete cascade,
  source_inbox_email text not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  gmail_history_id text,
  gmail_internal_date text,
  gmail_link text,
  label_ids text[],
  sender_email text,
  sender_name text,
  recipient_emails text[],
  cc_emails text[],
  bcc_emails text[],
  reply_to text,
  subject text,
  snippet text,
  body_text text,
  body_html text,
  raw_mime text,
  headers_json jsonb,
  payload_json jsonb,
  size_estimate integer,
  received_at timestamptz,
  sent_at timestamptz,
  is_external boolean,
  is_automated_alert boolean,
  has_attachments boolean not null default false,
  attachment_count integer not null default 0,
  ingestion_status text not null default 'stored',
  processing_status text not null default 'awaiting_classification',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_inbox_email, gmail_message_id)
);

create table if not exists email_attachments (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,
  gmail_attachment_id text not null,
  filename text,
  mime_type text,
  file_size integer,
  storage_bucket text,
  storage_path text,
  content_text text,
  content_extraction_status text not null default 'not_attempted',
  content_extraction_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inbound_email_id, gmail_attachment_id)
);

create table if not exists ingestion_errors (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid references ingestion_runs(id) on delete set null,
  monitored_inbox_id uuid references monitored_inboxes(id) on delete set null,
  inbound_email_id uuid references inbound_emails(id) on delete set null,
  gmail_message_id text,
  error_stage text not null,
  error_code text,
  error_message text,
  retry_count integer not null default 0,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_monitored_inboxes_email on monitored_inboxes(email_address);
create index if not exists idx_oauth_accounts_inbox on oauth_accounts(monitored_inbox_id);
create index if not exists idx_gmail_watch_states_email on gmail_watch_states(email_address);
create index if not exists idx_pubsub_notifications_history on pubsub_notifications(email_address, history_id);
create index if not exists idx_ingestion_runs_started_at on ingestion_runs(started_at desc);
create index if not exists idx_inbound_emails_source_received on inbound_emails(source_inbox_email, received_at desc);
create index if not exists idx_inbound_emails_gmail_thread on inbound_emails(gmail_thread_id);
create index if not exists idx_email_attachments_email on email_attachments(inbound_email_id);
create index if not exists idx_ingestion_errors_run on ingestion_errors(ingestion_run_id);
create index if not exists idx_ingestion_errors_stage on ingestion_errors(error_stage);

-- Optional updated_at trigger helper.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_monitored_inboxes_updated_at on monitored_inboxes;
create trigger trg_monitored_inboxes_updated_at
before update on monitored_inboxes
for each row execute function set_updated_at();

drop trigger if exists trg_oauth_accounts_updated_at on oauth_accounts;
create trigger trg_oauth_accounts_updated_at
before update on oauth_accounts
for each row execute function set_updated_at();

drop trigger if exists trg_gmail_watch_states_updated_at on gmail_watch_states;
create trigger trg_gmail_watch_states_updated_at
before update on gmail_watch_states
for each row execute function set_updated_at();

drop trigger if exists trg_inbound_emails_updated_at on inbound_emails;
create trigger trg_inbound_emails_updated_at
before update on inbound_emails
for each row execute function set_updated_at();

drop trigger if exists trg_email_attachments_updated_at on email_attachments;
create trigger trg_email_attachments_updated_at
before update on email_attachments
for each row execute function set_updated_at();

drop trigger if exists trg_ingestion_errors_updated_at on ingestion_errors;
create trigger trg_ingestion_errors_updated_at
before update on ingestion_errors
for each row execute function set_updated_at();
