-- Add archived status support to triage_items.
-- Adds archived_at / archived_by tracking columns.
-- Safe to run multiple times.

ALTER TABLE triage_items
  ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by  TEXT;
