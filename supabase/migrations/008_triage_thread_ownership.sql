-- 008_triage_thread_ownership.sql
-- One triage case per Gmail thread + non-destructive duplicate canonicalization.
--
-- Safe to run multiple times (all statements are idempotent, and the backfill
-- deterministically recomputes from the source of truth on every run).
--
-- Does NOT delete any rows, emails, attachments, classifications, or audit
-- history. Historical duplicate triage rows are PRESERVED; active duplicates in
-- the same thread are simply linked to a single canonical case via
-- superseded_by_triage_item_id so active queue views can show one case per thread.
-- Setting the column back to NULL fully restores the previous behaviour.

-- 1. Columns --------------------------------------------------------------------

ALTER TABLE triage_items
  -- Denormalized Gmail thread id, mirrored from the linked inbound email.
  -- Nullable: emails without a Gmail thread id fall back to per-email identity.
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  -- When set, this triage row is a historical/active duplicate of another triage
  -- row for the same Gmail thread. Active queue views exclude superseded rows.
  ADD COLUMN IF NOT EXISTS superseded_by_triage_item_id UUID
    REFERENCES triage_items(id) ON DELETE SET NULL;

-- 2. Indexes --------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_triage_items_gmail_thread
  ON triage_items(gmail_thread_id);

CREATE INDEX IF NOT EXISTS idx_triage_items_superseded_by
  ON triage_items(superseded_by_triage_item_id);

-- 3. Backfill gmail_thread_id from the linked inbound email ----------------------
--    Idempotent: refreshes every row from the source of truth.

UPDATE triage_items ti
SET gmail_thread_id = ie.gmail_thread_id,
    updated_at      = ti.updated_at            -- keep last-activity stable
FROM inbound_emails ie
WHERE ie.id = ti.inbound_email_id
  AND ti.gmail_thread_id IS DISTINCT FROM ie.gmail_thread_id;

-- 4. Canonicalize active duplicates per thread (non-destructive) -----------------
--    For each Gmail thread that has more than one ACTIVE (non-closed) triage row,
--    keep the most-recently-active row as canonical and point the others at it.
--    Recomputed from scratch each run for full idempotency.

-- 4a. Clear any prior canonicalization so the recompute is authoritative.
UPDATE triage_items
SET superseded_by_triage_item_id = NULL
WHERE superseded_by_triage_item_id IS NOT NULL;

-- 4b. Link non-canonical active duplicates to their canonical case.
WITH ranked AS (
  SELECT
    id,
    gmail_thread_id,
    ROW_NUMBER() OVER (
      PARTITION BY gmail_thread_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY gmail_thread_id) AS thread_count,
    FIRST_VALUE(id) OVER (
      PARTITION BY gmail_thread_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS canonical_id
  FROM triage_items
  WHERE gmail_thread_id IS NOT NULL
    AND status NOT IN ('resolved', 'archived', 'ignored')
)
UPDATE triage_items t
SET superseded_by_triage_item_id = r.canonical_id,
    updated_at = t.updated_at
FROM ranked r
WHERE t.id = r.id
  AND r.thread_count > 1
  AND r.rn > 1;
