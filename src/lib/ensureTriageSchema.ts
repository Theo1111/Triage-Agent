import { query } from "@/src/lib/db";

// Self-healing schema guard for the triage thread/ownership columns added in
// migration 008. Mirrors the operator_profiles auto-init pattern so the dashboard
// never 500s if the migration file has not been applied yet.
//
// This only performs the cheap, idempotent DDL (ADD COLUMN IF NOT EXISTS +
// indexes). The historical backfill (linking existing duplicate threads to a
// canonical case) lives in 008_triage_thread_ownership.sql and is NOT run here —
// it is a one-time data migration, not something to repeat on every cold start.

let _ensured: Promise<void> | null = null;

async function ensure(): Promise<void> {
  await query(`
    ALTER TABLE triage_items
      ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
      ADD COLUMN IF NOT EXISTS superseded_by_triage_item_id UUID
        REFERENCES triage_items(id) ON DELETE SET NULL
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_triage_items_gmail_thread ON triage_items(gmail_thread_id)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_triage_items_superseded_by ON triage_items(superseded_by_triage_item_id)`
  );
}

export function ensureTriageSchema(): Promise<void> {
  if (!_ensured) {
    _ensured = ensure().catch(err => {
      console.error("[ensureTriageSchema] init failed:", err);
      _ensured = null; // allow retry on next request
      throw err;
    });
  }
  return _ensured;
}
