import * as errorsRepo from "@/src/repositories/ingestionErrorsRepository";
import type { ErrorStage } from "@/src/types/database";

export async function logError(input: {
  ingestionRunId?: string | null;
  monitoredInboxId?: string | null;
  inboundEmailId?: string | null;
  gmailMessageId?: string | null;
  stage: ErrorStage;
  error: unknown;
  code?: string;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  console.error(`[ingestion-error] stage=${input.stage} message=${message}`, {
    runId: input.ingestionRunId,
    inboxId: input.monitoredInboxId,
    messageId: input.gmailMessageId,
  });

  try {
    await errorsRepo.insert({
      ingestionRunId: input.ingestionRunId ?? null,
      monitoredInboxId: input.monitoredInboxId ?? null,
      inboundEmailId: input.inboundEmailId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
      errorStage: input.stage,
      errorCode: input.code ?? null,
      errorMessage: message,
    });
  } catch (dbErr) {
    // Never let error logging crash the pipeline.
    console.error("[ingestion-error] Failed to write error to DB:", dbErr);
  }
}
