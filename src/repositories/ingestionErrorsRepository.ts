import { queryOne } from "@/src/lib/db";
import type { ErrorStage } from "@/src/types/database";

export async function insert(input: {
  ingestionRunId?: string | null;
  monitoredInboxId?: string | null;
  inboundEmailId?: string | null;
  gmailMessageId?: string | null;
  errorStage: ErrorStage;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await queryOne(
    `INSERT INTO ingestion_errors
       (ingestion_run_id, monitored_inbox_id, inbound_email_id, gmail_message_id,
        error_stage, error_code, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.ingestionRunId ?? null,
      input.monitoredInboxId ?? null,
      input.inboundEmailId ?? null,
      input.gmailMessageId ?? null,
      input.errorStage,
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ]
  );
}
