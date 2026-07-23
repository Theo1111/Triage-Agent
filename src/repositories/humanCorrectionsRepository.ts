import { query, queryOne } from "@/src/lib/db";

// Persistence for human classification corrections (migration 010). Self-heals
// the table on first use (mirrors the operator_profiles pattern) so the feature
// works even if the migration file has not been applied yet.

export interface HumanCorrectionRow {
  id: string;
  triage_item_id: string;
  inbound_email_id: string | null;
  classification_id: string | null;
  operator_profile_id: string | null;
  operator_username: string;
  relevance: string | null;
  urgency_level: string | null;
  sensitivity_level: string | null;
  primary_category: string | null;
  recommended_owner: string | null;
  route_type: string | null;
  slack_eligible: boolean | null;
  manual_review_required: boolean | null;
  summary: string | null;
  recommended_next_step: string | null;
  original: Record<string, unknown> | null;
  corrected: Record<string, unknown> | null;
  reason: string;
  model_name: string | null;
  prompt_version: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

export type ReviewStatus =
  | "pending"
  | "approved_for_eval"
  | "needs_context"
  | "duplicate"
  | "rejected";

let _ensured: Promise<void> | null = null;

async function ensure(): Promise<void> {
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await query(`
    CREATE TABLE IF NOT EXISTS human_classification_corrections (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      triage_item_id        uuid NOT NULL REFERENCES triage_items(id) ON DELETE CASCADE,
      inbound_email_id      uuid REFERENCES inbound_emails(id) ON DELETE SET NULL,
      classification_id     uuid REFERENCES email_classifications(id) ON DELETE SET NULL,
      operator_profile_id   uuid REFERENCES operator_profiles(id) ON DELETE SET NULL,
      operator_username     text NOT NULL,
      relevance             text,
      urgency_level         text,
      sensitivity_level     text,
      primary_category      text,
      recommended_owner     text,
      route_type            text,
      slack_eligible        boolean,
      manual_review_required boolean,
      summary               text,
      recommended_next_step text,
      original              jsonb,
      corrected             jsonb,
      reason                text NOT NULL,
      model_name            text,
      prompt_version        text,
      review_status         text NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved_for_eval','needs_context','duplicate','rejected')),
      reviewed_by           text,
      reviewed_at           timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_hcc_triage_item ON human_classification_corrections(triage_item_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_hcc_review_status ON human_classification_corrections(review_status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_hcc_created_at ON human_classification_corrections(created_at DESC)`);
}

export function ensureCorrectionsTable(): Promise<void> {
  if (!_ensured) {
    _ensured = ensure().catch(err => {
      _ensured = null;
      throw err;
    });
  }
  return _ensured;
}

export interface InsertCorrectionInput {
  triageItemId: string;
  inboundEmailId?: string | null;
  classificationId?: string | null;
  operatorProfileId?: string | null;
  operatorUsername: string;
  fields: {
    relevance?: string | null;
    urgency_level?: string | null;
    sensitivity_level?: string | null;
    primary_category?: string | null;
    recommended_owner?: string | null;
    route_type?: string | null;
    slack_eligible?: boolean | null;
    manual_review_required?: boolean | null;
    summary?: string | null;
    recommended_next_step?: string | null;
  };
  original: Record<string, unknown>;
  corrected: Record<string, unknown>;
  reason: string;
  modelName?: string | null;
  promptVersion?: string | null;
}

export async function insertCorrection(input: InsertCorrectionInput): Promise<HumanCorrectionRow> {
  await ensureCorrectionsTable();
  const f = input.fields;
  const row = await queryOne<HumanCorrectionRow>(
    `INSERT INTO human_classification_corrections (
       triage_item_id, inbound_email_id, classification_id, operator_profile_id, operator_username,
       relevance, urgency_level, sensitivity_level, primary_category, recommended_owner, route_type,
       slack_eligible, manual_review_required, summary, recommended_next_step,
       original, corrected, reason, model_name, prompt_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      input.triageItemId,
      input.inboundEmailId ?? null,
      input.classificationId ?? null,
      input.operatorProfileId ?? null,
      input.operatorUsername,
      f.relevance ?? null,
      f.urgency_level ?? null,
      f.sensitivity_level ?? null,
      f.primary_category ?? null,
      f.recommended_owner ?? null,
      f.route_type ?? null,
      f.slack_eligible ?? null,
      f.manual_review_required ?? null,
      f.summary ?? null,
      f.recommended_next_step ?? null,
      JSON.stringify(input.original),
      JSON.stringify(input.corrected),
      input.reason,
      input.modelName ?? null,
      input.promptVersion ?? null,
    ]
  );
  if (!row) throw new Error("Failed to insert human correction");
  return row;
}

export async function findLatestByTriageItemId(triageItemId: string): Promise<HumanCorrectionRow | null> {
  await ensureCorrectionsTable();
  return queryOne<HumanCorrectionRow>(
    `SELECT * FROM human_classification_corrections
     WHERE triage_item_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [triageItemId]
  );
}

export async function listByReviewStatus(
  status: ReviewStatus | "all",
  limit = 200
): Promise<HumanCorrectionRow[]> {
  await ensureCorrectionsTable();
  if (status === "all") {
    return query<HumanCorrectionRow>(
      `SELECT * FROM human_classification_corrections ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  }
  return query<HumanCorrectionRow>(
    `SELECT * FROM human_classification_corrections WHERE review_status = $1 ORDER BY created_at DESC LIMIT $2`,
    [status, limit]
  );
}

export async function updateReviewStatus(
  id: string,
  status: ReviewStatus,
  reviewedBy: string
): Promise<HumanCorrectionRow | null> {
  await ensureCorrectionsTable();
  return queryOne<HumanCorrectionRow>(
    `UPDATE human_classification_corrections
     SET review_status = $2, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, reviewedBy]
  );
}

// Which triage items currently have any correction — for the "corrected" badge.
export async function triageItemIdsWithCorrections(): Promise<string[]> {
  await ensureCorrectionsTable();
  const rows = await query<{ triage_item_id: string }>(
    `SELECT DISTINCT triage_item_id FROM human_classification_corrections`
  );
  return rows.map(r => r.triage_item_id);
}

export interface CorrectionAnalytics {
  total: number;
  byCorrectedOwner: Record<string, number>;
  byCorrectedCategory: Record<string, number>;
  urgencyCorrections: number;
  sensitivityCorrections: number;
  byPromptVersion: Record<string, number>;
  byReviewStatus: Record<string, number>;
}

export async function correctionAnalytics(): Promise<CorrectionAnalytics> {
  await ensureCorrectionsTable();
  const rows = await query<HumanCorrectionRow>(
    `SELECT * FROM human_classification_corrections ORDER BY created_at DESC LIMIT 5000`
  );
  const out: CorrectionAnalytics = {
    total: rows.length,
    byCorrectedOwner: {},
    byCorrectedCategory: {},
    urgencyCorrections: 0,
    sensitivityCorrections: 0,
    byPromptVersion: {},
    byReviewStatus: {},
  };
  for (const r of rows) {
    if (r.recommended_owner) out.byCorrectedOwner[r.recommended_owner] = (out.byCorrectedOwner[r.recommended_owner] ?? 0) + 1;
    if (r.primary_category) out.byCorrectedCategory[r.primary_category] = (out.byCorrectedCategory[r.primary_category] ?? 0) + 1;
    if (r.urgency_level) out.urgencyCorrections++;
    if (r.sensitivity_level) out.sensitivityCorrections++;
    const pv = r.prompt_version ?? "unknown";
    out.byPromptVersion[pv] = (out.byPromptVersion[pv] ?? 0) + 1;
    out.byReviewStatus[r.review_status] = (out.byReviewStatus[r.review_status] ?? 0) + 1;
  }
  return out;
}
