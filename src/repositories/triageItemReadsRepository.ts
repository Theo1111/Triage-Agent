import { query } from "@/src/lib/db";

// Upsert a read record for an operator viewing a triage item.
// ON CONFLICT updates last_viewed_at to now() so subsequent opens refresh the timestamp.
export async function upsertRead(triageItemId: string, operatorId: string): Promise<void> {
  await query(
    `INSERT INTO triage_item_operator_reads
       (triage_item_id, operator_profile_id, last_viewed_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (triage_item_id, operator_profile_id)
     DO UPDATE SET last_viewed_at = now(), updated_at = now()`,
    [triageItemId, operatorId]
  );
}
