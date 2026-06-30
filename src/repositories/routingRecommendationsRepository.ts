import { queryOne } from "@/src/lib/db";
import type { RoutingRecommendation, RouteType } from "@/src/types/database";

export interface InsertRoutingRecommendationInput {
  inboundEmailId: string;
  classificationId?: string | null;
  routeType: RouteType;
  targetOwner?: string | null;
  targetOwnerEmail?: string | null;
  targetChannel?: string | null;
  recommendedAction?: string | null;
  routeReason?: string | null;
}

// Marks any existing current recommendation as superseded, then inserts the new one.
export async function insertAsCurrent(
  input: InsertRoutingRecommendationInput
): Promise<RoutingRecommendation> {
  await queryOne(
    `UPDATE routing_recommendations SET is_current = false, updated_at = now()
     WHERE inbound_email_id = $1 AND is_current = true`,
    [input.inboundEmailId]
  );

  const row = await queryOne<RoutingRecommendation>(
    `INSERT INTO routing_recommendations (
       inbound_email_id, classification_id,
       route_type, target_owner, target_owner_email,
       target_channel, recommended_action, route_reason,
       is_current
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
     RETURNING *`,
    [
      input.inboundEmailId,
      input.classificationId ?? null,
      input.routeType,
      input.targetOwner ?? null,
      input.targetOwnerEmail ?? null,
      input.targetChannel ?? null,
      input.recommendedAction ?? null,
      input.routeReason ?? null,
    ]
  );
  if (!row) throw new Error(`Failed to insert routing recommendation for email ${input.inboundEmailId}`);
  return row;
}

export async function findCurrentByEmailId(
  inboundEmailId: string
): Promise<RoutingRecommendation | null> {
  return queryOne<RoutingRecommendation>(
    "SELECT * FROM routing_recommendations WHERE inbound_email_id = $1 AND is_current = true",
    [inboundEmailId]
  );
}
