-- 003_triage_items.sql
-- Durable triage/escalation records that track ownership and resolution status.
-- One row per actionable email. Not created for not_relevant/ignored emails.

CREATE TABLE IF NOT EXISTS triage_items (
  id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_email_id          uuid         NOT NULL REFERENCES inbound_emails(id) ON DELETE CASCADE,
  classification_id         uuid         REFERENCES email_classifications(id) ON DELETE SET NULL,
  routing_recommendation_id uuid         REFERENCES routing_recommendations(id) ON DELETE SET NULL,

  -- Denormalized for fast reads without joins
  source_inbox_email        text         NOT NULL,
  sender_email              text,
  sender_name               text,
  subject                   text,
  summary                   text,
  urgency_level             text         NOT NULL,
  sensitivity_level         text         NOT NULL,
  route_type                text         NOT NULL,
  owner                     text,
  recommended_next_step     text,

  -- Lifecycle
  status                    text         NOT NULL DEFAULT 'new',
  slack_message_ts          text,
  slack_channel             text,

  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  assigned_at               timestamptz,
  resolved_at               timestamptz,
  escalated_at              timestamptz,

  CONSTRAINT triage_items_status_check CHECK (
    status IN ('new', 'assigned', 'escalated', 'resolved', 'ignored', 'manual_review')
  )
);

CREATE INDEX IF NOT EXISTS idx_triage_items_email
  ON triage_items(inbound_email_id);

CREATE INDEX IF NOT EXISTS idx_triage_items_status
  ON triage_items(status);

CREATE INDEX IF NOT EXISTS idx_triage_items_owner
  ON triage_items(owner)
  WHERE owner IS NOT NULL;

-- Fast open-item dashboard query: urgent unresolved items first
CREATE INDEX IF NOT EXISTS idx_triage_items_open
  ON triage_items(status, urgency_level, created_at DESC)
  WHERE status NOT IN ('resolved', 'ignored');

DROP TRIGGER IF EXISTS trg_triage_items_updated_at ON triage_items;
CREATE TRIGGER trg_triage_items_updated_at
  BEFORE UPDATE ON triage_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
