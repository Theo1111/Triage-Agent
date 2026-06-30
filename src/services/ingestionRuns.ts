import * as runsRepo from "@/src/repositories/ingestionRunsRepository";
import type { IngestionRun, IngestionRunTrigger } from "@/src/types/database";

export async function startRun(input: {
  runId: string;
  triggerType: IngestionRunTrigger;
  triggerSource?: string;
}): Promise<IngestionRun> {
  return runsRepo.create(input);
}

export interface RunCounts {
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

export async function finishRun(run: IngestionRun, counts: RunCounts): Promise<void> {
  const hasErrors = (counts.errors ?? 0) > 0;
  const hasStored = (counts.newMessagesStored ?? 0) > 0;

  let status: "success" | "partial_success" | "failed";
  if (!hasStored && hasErrors) {
    status = "failed";
  } else if (hasErrors) {
    status = "partial_success";
  } else {
    status = "success";
  }

  await runsRepo.finish(run.id, status, counts);
  console.log(`[ingestion-run] run=${run.run_id} status=${status}`, counts);
}
