-- 006_triage_archive_complete.sql
-- Completes archive support for triage_items.
-- Safe to run multiple times (all statements are idempotent).
--
-- Fixes:
--   1. Adds archive + restore tracking columns (safe if 004 already ran).
--   2. Drops the old status CHECK constraint and recreates it with 'archived'
--      included — the root cause of the "column archived_at does not exist" and
--      "invalid input value for enum" production errors.
--
-- Does NOT delete rows, reset statuses, or drop any columns.

-- 1. Archive + restore columns --------------------------------------------------

ALTER TABLE triage_items
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by     TEXT,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by     TEXT;

-- 2. Status CHECK constraint (must include 'archived') --------------------------
--    The constraint from 003_triage_items.sql omitted 'archived'.
--    Drop it if it exists and recreate with the full status set.

ALTER TABLE triage_items
  DROP CONSTRAINT IF EXISTS triage_items_status_check;

ALTER TABLE triage_items
  ADD CONSTRAINT triage_items_status_check CHECK (
    status IN (
      'new',
      'assigned',
      'escalated',
      'resolved',
      'ignored',
      'manual_review',
      'archived'
    )
  );
