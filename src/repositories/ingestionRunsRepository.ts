import { queryOne } from "@/src/lib/db";
import type { IngestionRun, IngestionRunStatus, IngestionRunTrigger } from "@/src/types/database";

export async function create(input: {
  runId: string;
  triggerType: IngestionRunTrigger;
  triggerSource?: string;
}): Promise<IngestionRun> {
  const row = await queryOne<IngestionRun>(
    `INSERT INTO ingestion_runs (run_id, trigger_type, trigger_source)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.runId, input.triggerType, input.triggerSource ?? null]
  );
  if (!row) throw new Error("Failed to create ingestion run");
  return row;
}

export async function finish(
  id: string,
  status: IngestionRunStatus,
  counts: {
    inboxesChecked?: number;
    messagesFound?: number;
    newMessagesStored?: number;
    duplicatesSkipped?: number;
    externalMessagesSkipped?: number;
    automatedAlertsSkipped?: number;
    attachmentsFound?: number;
    attachmentsStored?: number;
    attachmentParseFailures?: number;
    errors?: number;
  }
): Promise<void> {
  await queryOne(
    `UPDATE ingestion_runs SET
       status = $1,
       finished_at = now(),
       inboxes_checked = $2,
       messages_found = $3,
       new_messages_stored = $4,
       duplicates_skipped = $5,
       external_messages_skipped = $6,
       automated_alerts_skipped = $7,
       attachments_found = $8,
       attachments_stored = $9,
       attachment_parse_failures = $10,
       errors = $11
     WHERE id = $12`,
    [
      status,
      counts.inboxesChecked ?? 0,
      counts.messagesFound ?? 0,
      counts.newMessagesStored ?? 0,
      counts.duplicatesSkipped ?? 0,
      counts.externalMessagesSkipped ?? 0,
      counts.automatedAlertsSkipped ?? 0,
      counts.attachmentsFound ?? 0,
      counts.attachmentsStored ?? 0,
      counts.attachmentParseFailures ?? 0,
      counts.errors ?? 0,
      id,
    ]
  );
}
