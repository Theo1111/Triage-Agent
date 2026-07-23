-- 010_human_classification_corrections.sql
-- Structured operator corrections to the agent's classification, stored as a
-- SEPARATE human-reviewed layer. The original model result (email_classifications
-- + classification_runs.raw_response) is never overwritten or deleted.
--
-- Additive, idempotent, non-destructive.

CREATE TABLE IF NOT EXISTS human_classification_corrections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triage_item_id        uuid NOT NULL REFERENCES triage_items(id) ON DELETE CASCADE,
  inbound_email_id      uuid REFERENCES inbound_emails(id) ON DELETE SET NULL,
  classification_id     uuid REFERENCES email_classifications(id) ON DELETE SET NULL,
  operator_profile_id   uuid REFERENCES operator_profiles(id) ON DELETE SET NULL,
  operator_username     text NOT NULL,

  -- Corrected fields. NULL = this field was not corrected (defer to the AI value).
  relevance             text,   -- 'actionable' | 'irrelevant'
  urgency_level         text,
  sensitivity_level     text,
  primary_category      text,
  recommended_owner     text,
  route_type            text,
  slack_eligible        boolean,
  manual_review_required boolean,
  summary               text,
  recommended_next_step text,

  -- Snapshots for audit + evaluation export.
  original              jsonb,  -- AI values at correction time
  corrected             jsonb,  -- the corrected values applied
  reason                text NOT NULL,

  model_name            text,
  prompt_version        text,

  -- Admin review lifecycle for feedback → evaluation.
  review_status         text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved_for_eval', 'needs_context', 'duplicate', 'rejected')),
  reviewed_by           text,
  reviewed_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hcc_triage_item ON human_classification_corrections(triage_item_id);
CREATE INDEX IF NOT EXISTS idx_hcc_review_status ON human_classification_corrections(review_status);
CREATE INDEX IF NOT EXISTS idx_hcc_created_at ON human_classification_corrections(created_at DESC);
