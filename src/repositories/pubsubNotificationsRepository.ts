import { queryOne } from "@/src/lib/db";
import type { PubSubNotification, PubSubNotificationStatus } from "@/src/types/database";

export async function insertIfNew(input: {
  pubsubMessageId: string;
  emailAddress: string | null;
  historyId: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<{ inserted: boolean; row: PubSubNotification }> {
  // INSERT … ON CONFLICT DO NOTHING, then check if a row was returned.
  const row = await queryOne<PubSubNotification>(
    `INSERT INTO pubsub_notifications (pubsub_message_id, email_address, history_id, raw_payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pubsub_message_id) DO NOTHING
     RETURNING *`,
    [input.pubsubMessageId, input.emailAddress, input.historyId, JSON.stringify(input.rawPayload)]
  );

  if (row) {
    return { inserted: true, row };
  }

  // Duplicate — fetch the existing record.
  const existing = await queryOne<PubSubNotification>(
    "SELECT * FROM pubsub_notifications WHERE pubsub_message_id = $1",
    [input.pubsubMessageId]
  );
  if (!existing) throw new Error(`Pub/Sub notification ${input.pubsubMessageId} disappeared unexpectedly`);
  return { inserted: false, row: existing };
}

export async function updateStatus(
  id: string,
  status: PubSubNotificationStatus,
  errorMessage?: string
): Promise<void> {
  await queryOne(
    `UPDATE pubsub_notifications SET
       status = $1,
       processed_at = CASE WHEN $1 IN ('processed', 'failed', 'duplicate') THEN now() ELSE processed_at END,
       error_message = $2
     WHERE id = $3`,
    [status, errorMessage ?? null, id]
  );
}
