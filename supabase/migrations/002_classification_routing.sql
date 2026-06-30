-- 002_classification_routing.sql
-- Adds classification, sensitivity, routing, and audit-log structure.

create extension if not exists "pgcrypto";

create table if not exists classification_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,

  trigger_type text not null default 'new_email',
  status text not null default 'started'
    check (status in ('started', 'success', 'partial_success', 'failed')),

  model_name text,
  prompt_version text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  input_tokens integer,
  output_tokens integer,
  total_tokens integer,

  error_message text,
  raw_response jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_classifications (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,
  classification_run_id uuid references classification_runs(id) on delete set null,

  urgency_level text not null
    check (urgency_level in ('urgent', 'normal', 'not_relevant', 'unknown')),

  sensitivity_level text not null
    check (sensitivity_level in ('public_internal', 'private', 'sensitive', 'unknown')),

  primary_category text,
  category_tags text[] not null default '{}',

  summary text,
  urgency_reason text,
  sensitivity_reason text,

  recommended_owner text,
  recommended_next_step text,

  confidence_score numeric(5,4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),

  model_name text,
  prompt_version text,

  is_current boolean not null default true,

  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(inbound_email_id, classification_run_id)
);

create unique index if not exists idx_email_classifications_one_current
on email_classifications(inbound_email_id)
where is_current = true;

create table if not exists sensitivity_reviews (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,
  classification_id uuid references email_classifications(id) on delete set null,

  is_sensitive boolean not null default false,

  sensitivity_categories text[] not null default '{}',
  -- examples: HR, legal, employment, personal_finance, contract, payroll, medical, personnel

  shared_slack_allowed boolean not null default true,
  private_route_required boolean not null default false,

  reason text,

  review_status text not null default 'system_decision'
    check (review_status in ('system_decision', 'needs_human_review', 'human_approved', 'human_overridden')),

  reviewed_by text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists routing_recommendations (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references inbound_emails(id) on delete cascade,
  classification_id uuid references email_classifications(id) on delete set null,

  route_type text not null
    check (route_type in ('slack_channel', 'private_owner', 'dashboard_only', 'ignore', 'manual_review')),

  target_owner text,
  target_owner_email text,
  target_channel text,

  recommended_action text,
  route_reason text,

  is_current boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_routing_recommendations_one_current
on routing_recommendations(inbound_email_id)
where is_current = true;

create table if not exists agent_audit_logs (
  id uuid primary key default gen_random_uuid(),

  inbound_email_id uuid references inbound_emails(id) on delete cascade,
  classification_run_id uuid references classification_runs(id) on delete set null,
  classification_id uuid references email_classifications(id) on delete set null,

  event_type text not null,
  -- examples: classification_started, classification_completed, sensitivity_flagged,
  -- routing_recommended, slack_post_blocked, slack_post_created, owner_assigned

  actor_type text not null default 'system'
    check (actor_type in ('system', 'agent', 'human', 'slack', 'api')),

  actor_id text,

  action text not null,
  reason text,

  before_state jsonb,
  after_state jsonb,
  metadata jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_classification_runs_email
on classification_runs(inbound_email_id);

create index if not exists idx_classification_runs_status
on classification_runs(status);

create index if not exists idx_email_classifications_email
on email_classifications(inbound_email_id);

create index if not exists idx_email_classifications_urgency
on email_classifications(urgency_level);

create index if not exists idx_email_classifications_sensitivity
on email_classifications(sensitivity_level);

create index if not exists idx_sensitivity_reviews_email
on sensitivity_reviews(inbound_email_id);

create index if not exists idx_sensitivity_reviews_sensitive
on sensitivity_reviews(is_sensitive);

create index if not exists idx_routing_recommendations_email
on routing_recommendations(inbound_email_id);

create index if not exists idx_routing_recommendations_route_type
on routing_recommendations(route_type);

create index if not exists idx_agent_audit_logs_email
on agent_audit_logs(inbound_email_id);

create index if not exists idx_agent_audit_logs_event_type
on agent_audit_logs(event_type);

create index if not exists idx_agent_audit_logs_created_at
on agent_audit_logs(created_at desc);

create index if not exists idx_inbound_emails_processing_status
on inbound_emails(processing_status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_classification_runs_updated_at on classification_runs;
create trigger trg_classification_runs_updated_at
before update on classification_runs
for each row execute function set_updated_at();

drop trigger if exists trg_email_classifications_updated_at on email_classifications;
create trigger trg_email_classifications_updated_at
before update on email_classifications
for each row execute function set_updated_at();

drop trigger if exists trg_sensitivity_reviews_updated_at on sensitivity_reviews;
create trigger trg_sensitivity_reviews_updated_at
before update on sensitivity_reviews
for each row execute function set_updated_at();

drop trigger if exists trg_routing_recommendations_updated_at on routing_recommendations;
create trigger trg_routing_recommendations_updated_at
before update on routing_recommendations
for each row execute function set_updated_at();