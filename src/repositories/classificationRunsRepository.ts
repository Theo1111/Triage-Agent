import { query, queryOne } from "@/src/lib/db";
import type { ClassificationRun, ClassificationRunStatus } from "@/src/types/database";

export async function create(input: {
  runId: string;
  inboundEmailId: string;
  triggerType?: string;
  modelName?: string | null;
  promptVersion?: string | null;
}): Promise<ClassificationRun> {
  const row = await queryOne<ClassificationRun>(
    `INSERT INTO classification_runs
       (run_id, inbound_email_id, trigger_type, model_name, prompt_version)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.runId,
      input.inboundEmailId,
      input.triggerType ?? "new_email",
      input.modelName ?? null,
      input.promptVersion ?? null,
    ]
  );
  if (!row) throw new Error(`Failed to create classification_run for email ${input.inboundEmailId}`);
  return row;
}

export async function finish(
  id: string,
  status: ClassificationRunStatus,
  result: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    errorMessage?: string | null;
    rawResponse?: Record<string, unknown> | null;
  }
): Promise<void> {
  await queryOne(
    `UPDATE classification_runs SET
       status = $1,
       finished_at = now(),
       input_tokens = $2,
       output_tokens = $3,
       total_tokens = $4,
       error_message = $5,
       raw_response = $6,
       updated_at = now()
     WHERE id = $7`,
    [
      status,
      result.inputTokens ?? null,
      result.outputTokens ?? null,
      result.totalTokens ?? null,
      result.errorMessage ?? null,
      result.rawResponse ? JSON.stringify(result.rawResponse) : null,
      id,
    ]
  );
}

export async function findById(id: string): Promise<ClassificationRun | null> {
  return queryOne<ClassificationRun>(
    "SELECT * FROM classification_runs WHERE id = $1",
    [id]
  );
}

export async function findByEmailId(inboundEmailId: string): Promise<ClassificationRun[]> {
  return query<ClassificationRun>(
    "SELECT * FROM classification_runs WHERE inbound_email_id = $1 ORDER BY started_at DESC",
    [inboundEmailId]
  );
}
