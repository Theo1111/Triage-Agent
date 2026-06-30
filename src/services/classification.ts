import { randomUUID } from "crypto";
import * as classificationRunsRepo from "@/src/repositories/classificationRunsRepository";
import * as emailClassificationsRepo from "@/src/repositories/emailClassificationsRepository";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import type {
  ClassificationRun,
  EmailClassification,
  UrgencyLevel,
  SensitivityLevel,
} from "@/src/types/database";

// ─── Classification run lifecycle ──────────────────────────────────────────

export async function createClassificationRun(input: {
  inboundEmailId: string;
  triggerType?: string;
  modelName?: string | null;
  promptVersion?: string | null;
}): Promise<ClassificationRun> {
  const run = await classificationRunsRepo.create({
    runId: randomUUID(),
    inboundEmailId: input.inboundEmailId,
    triggerType: input.triggerType ?? "new_email",
    modelName: input.modelName ?? null,
    promptVersion: input.promptVersion ?? null,
  });
  console.log(`[classification] run started run_id=${run.run_id} email=${input.inboundEmailId}`);
  return run;
}

export async function finishClassificationRun(
  run: ClassificationRun,
  outcome: {
    status: "success" | "partial_success" | "failed";
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    errorMessage?: string | null;
    rawResponse?: Record<string, unknown> | null;
  }
): Promise<void> {
  await classificationRunsRepo.finish(run.id, outcome.status, {
    inputTokens: outcome.inputTokens ?? null,
    outputTokens: outcome.outputTokens ?? null,
    totalTokens: outcome.totalTokens ?? null,
    errorMessage: outcome.errorMessage ?? null,
    rawResponse: outcome.rawResponse ?? null,
  });
  console.log(`[classification] run finished run_id=${run.run_id} status=${outcome.status}`);
}

// ─── Saving classification results ─────────────────────────────────────────

export interface SaveClassificationInput {
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

export async function saveClassificationResult(
  input: SaveClassificationInput
): Promise<EmailClassification> {
  const classification = await emailClassificationsRepo.insertAsCurrent(input);

  // Advance the email's processing status so downstream steps know it's ready.
  await inboundEmailsRepo.updateProcessingStatus(input.inboundEmailId, "classification_ready");

  console.log(
    `[classification] saved email=${input.inboundEmailId} ` +
    `urgency=${input.urgencyLevel} sensitivity=${input.sensitivityLevel}`
  );
  return classification;
}

// ─── Lookups ───────────────────────────────────────────────────────────────

export async function getCurrentClassification(
  inboundEmailId: string
): Promise<EmailClassification | null> {
  return emailClassificationsRepo.findCurrentByEmailId(inboundEmailId);
}

// ─── Status helpers ────────────────────────────────────────────────────────

export async function markAwaitingClassification(inboundEmailId: string): Promise<void> {
  await inboundEmailsRepo.updateProcessingStatus(inboundEmailId, "awaiting_classification");
}

export async function markClassificationFailed(inboundEmailId: string): Promise<void> {
  await inboundEmailsRepo.updateProcessingStatus(inboundEmailId, "classification_failed");
}
