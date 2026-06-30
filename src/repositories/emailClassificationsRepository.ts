import { queryOne } from "@/src/lib/db";
import type { EmailClassification, UrgencyLevel, SensitivityLevel } from "@/src/types/database";

export interface InsertClassificationInput {
  inboundEmailId: string;
  classificationRunId?: string | null;
  urgencyLevel: UrgencyLevel;
  sensitivityLevel: SensitivityLevel;
  primaryCategory?: string | null;
  categoryTags?: string[];
  summary?: string | null;
  urgencyReason?: string | null;
  sensitivityReason?: string | null;
  recommendedOwner?: string | null;
  recommendedNextStep?: string | null;
  confidenceScore?: number | null;
  modelName?: string | null;
  promptVersion?: string | null;
}

// Marks any existing current classification for this email as superseded,
// then inserts the new one as current.
export async function insertAsCurrent(
  input: InsertClassificationInput
): Promise<EmailClassification> {
  // Unset the old current record (the unique partial index enforces at most one current per email).
  await queryOne(
    `UPDATE email_classifications SET is_current = false, updated_at = now()
     WHERE inbound_email_id = $1 AND is_current = true`,
    [input.inboundEmailId]
  );

  const row = await queryOne<EmailClassification>(
    `INSERT INTO email_classifications (
       inbound_email_id, classification_run_id,
       urgency_level, sensitivity_level,
       primary_category, category_tags,
       summary, urgency_reason, sensitivity_reason,
       recommended_owner, recommended_next_step,
       confidence_score, model_name, prompt_version,
       is_current
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
     RETURNING *`,
    [
      input.inboundEmailId,
      input.classificationRunId ?? null,
      input.urgencyLevel,
      input.sensitivityLevel,
      input.primaryCategory ?? null,
      input.categoryTags ?? [],
      input.summary ?? null,
      input.urgencyReason ?? null,
      input.sensitivityReason ?? null,
      input.recommendedOwner ?? null,
      input.recommendedNextStep ?? null,
      input.confidenceScore ?? null,
      input.modelName ?? null,
      input.promptVersion ?? null,
    ]
  );
  if (!row) throw new Error(`Failed to insert classification for email ${input.inboundEmailId}`);
  return row;
}

export async function findCurrentByEmailId(
  inboundEmailId: string
): Promise<EmailClassification | null> {
  return queryOne<EmailClassification>(
    "SELECT * FROM email_classifications WHERE inbound_email_id = $1 AND is_current = true",
    [inboundEmailId]
  );
}

export async function findById(id: string): Promise<EmailClassification | null> {
  return queryOne<EmailClassification>(
    "SELECT * FROM email_classifications WHERE id = $1",
    [id]
  );
}
