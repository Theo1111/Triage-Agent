-- Per-operator read state for triage items.
-- Tracks when each operator last viewed each triage item so the dashboard
-- can show a "NEW INFO" badge for items updated since the operator's last view.

create table if not exists triage_item_operator_reads (
  id uuid primary key default gen_random_uuid(),
  triage_item_id uuid not null references triage_items(id) on delete cascade,
  operator_profile_id uuid not null references operator_profiles(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  last_viewed_email_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(triage_item_id, operator_profile_id)
);

create index if not exists idx_triage_item_operator_reads_item
  on triage_item_operator_reads(triage_item_id);

create index if not exists idx_triage_item_operator_reads_operator
  on triage_item_operator_reads(operator_profile_id);
