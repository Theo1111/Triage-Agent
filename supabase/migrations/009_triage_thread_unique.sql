-- 009_triage_thread_unique.sql
-- Concurrency guard: at most ONE active (non-closed, non-superseded) triage case
-- per Gmail thread. Prevents two messages from the same thread that are processed
-- concurrently from both creating a canonical case.
--
-- Safe to run multiple times. Additive and non-destructive: no rows are deleted,
-- statuses are not rewritten. Depends on migration 008 (gmail_thread_id +
-- superseded_by_triage_item_id).
--
-- Closed cases (resolved/archived/ignored) and superseded rows are intentionally
-- excluded from the constraint, so a resolved case plus a newly reopened active
-- case in the same thread is still allowed.

-- 1. Re-run the 008 canonicalization so no active duplicates remain before we
--    add the unique index (idempotent — recomputes from the source of truth).
UPDATE triage_items
SET superseded_by_triage_item_id = NULL
WHERE superseded_by_triage_item_id IS NOT NULL;

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

-- 2. Enforce one active canonical case per thread.
CREATE UNIQUE INDEX IF NOT EXISTS idx_triage_items_one_active_per_thread
  ON triage_items (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL
    AND superseded_by_triage_item_id IS NULL
    AND status NOT IN ('resolved', 'archived', 'ignored');
