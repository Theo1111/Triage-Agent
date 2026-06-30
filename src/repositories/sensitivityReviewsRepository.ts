import { queryOne } from "@/src/lib/db";
import type { SensitivityReview, SensitivityReviewStatus } from "@/src/types/database";

export interface InsertSensitivityReviewInput {
  inboundEmailId: string;
  classificationId?: string | null;
  isSensitive: boolean;
  sensitivityCategories?: string[];
  sharedSlackAllowed?: boolean;
  privateRouteRequired?: boolean;
  reason?: string | null;
  reviewStatus?: SensitivityReviewStatus;
}

export async function insert(
  input: InsertSensitivityReviewInput
): Promise<SensitivityReview> {
  const row = await queryOne<SensitivityReview>(
    `INSERT INTO sensitivity_reviews (
       inbound_email_id, classification_id,
       is_sensitive, sensitivity_categories,
       shared_slack_allowed, private_route_required,
       reason, review_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.inboundEmailId,
      input.classificationId ?? null,
      input.isSensitive,
      input.sensitivityCategories ?? [],
      input.sharedSlackAllowed ?? true,
      input.privateRouteRequired ?? false,
      input.reason ?? null,
      input.reviewStatus ?? "system_decision",
    ]
  );
  if (!row) throw new Error(`Failed to insert sensitivity review for email ${input.inboundEmailId}`);
  return row;
}

export async function findLatestByEmailId(
  inboundEmailId: string
): Promise<SensitivityReview | null> {
  return queryOne<SensitivityReview>(
    `SELECT * FROM sensitivity_reviews WHERE inbound_email_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [inboundEmailId]
  );
}

export async function updateReviewStatus(input: {
  id: string;
  reviewStatus: SensitivityReviewStatus;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
}): Promise<void> {
  await queryOne(
    `UPDATE sensitivity_reviews SET
       review_status = $1,
       reviewed_by = $2,
       reviewed_at = now(),
       updated_at = now()
     WHERE id = $3`,
    [input.reviewStatus, input.reviewedBy ?? null, input.id]
  );
}
