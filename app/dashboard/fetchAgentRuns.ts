import { query } from "@/src/lib/db";
import type { SerializedAgentRun } from "./types";

type AgentRunRow = {
  id: string;
  run_id: string;
  inbound_email_id: string;
  status: string;
  model_name: string | null;
  prompt_version: string | null;
  started_at: Date;
  finished_at: Date | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  raw_response: Record<string, unknown> | string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  source_inbox_email: string | null;
  snippet: string | null;
  classification_id: string | null;
  urgency_level: string | null;
  sensitivity_level: string | null;
  primary_category: string | null;
  category_tags: string[] | null;
  summary: string | null;
  urgency_reason: string | null;
  sensitivity_reason: string | null;
  recommended_owner: string | null;
  recommended_next_step: string | null;
  confidence_score: number | null;
  route_type: string | null;
  triage_item_id: string | null;
  triage_status: string | null;
};

function toISO(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function parseRawResponse(
  raw: Record<string, unknown> | string | null
): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return raw;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function serialize(row: AgentRunRow): SerializedAgentRun {
  const raw = parseRawResponse(row.raw_response);

  return {
    id: row.id,
    run_id: row.run_id,
    inbound_email_id: row.inbound_email_id,
    status: row.status,
    model_name: row.model_name,
    prompt_version: row.prompt_version,
    started_at: row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    finished_at: toISO(row.finished_at),
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    error_message: row.error_message,
    subject: row.subject,
    sender_email: row.sender_email,
    sender_name: row.sender_name,
    source_inbox_email: row.source_inbox_email,
    snippet: row.snippet,
    classification_id: row.classification_id,
    urgency_level: row.urgency_level,
    sensitivity_level: row.sensitivity_level,
    primary_category: row.primary_category,
    category_tags: row.category_tags ?? [],
    summary: row.summary,
    urgency_reason: row.urgency_reason,
    sensitivity_reason: row.sensitivity_reason,
    recommended_owner: row.recommended_owner,
    recommended_next_step: row.recommended_next_step,
    confidence_score: row.confidence_score,
    route_type: row.route_type,
    triage_item_id: row.triage_item_id,
    triage_status: row.triage_status,
    operational_impact_detected:
      typeof raw?.operational_impact_detected === "boolean"
        ? raw.operational_impact_detected
        : null,
    needs_manual_review:
      typeof raw?.needs_manual_review === "boolean" ? raw.needs_manual_review : null,
    impact_reasoning:
      typeof raw?.impact_reasoning === "string" ? raw.impact_reasoning : null,
    matched_vocabulary_terms: asStringArray(raw?.matched_vocabulary_terms),
    human_language_signals: asStringArray(raw?.human_language_signals),
    safe_slack_summary:
      typeof raw?.safe_slack_summary === "string" ? raw.safe_slack_summary : null,
  };
}

export async function fetchRecentAgentRuns(limit = 200): Promise<SerializedAgentRun[]> {
  console.log(`[dashboard/agent] DB fetch started limit=${limit}`);

  const rows = await query<AgentRunRow>(
    `SELECT
       cr.id,
       cr.run_id,
       cr.inbound_email_id,
       cr.status,
       cr.model_name,
       cr.prompt_version,
       cr.started_at,
       cr.finished_at,
       cr.input_tokens,
       cr.output_tokens,
       cr.total_tokens,
       cr.error_message,
       cr.raw_response,
       ie.subject,
       ie.sender_email,
       ie.sender_name,
       ie.source_inbox_email,
       ie.snippet,
       ec.id AS classification_id,
       ec.urgency_level,
       ec.sensitivity_level,
       ec.primary_category,
       ec.category_tags,
       ec.summary,
       ec.urgency_reason,
       ec.sensitivity_reason,
       ec.recommended_owner,
       ec.recommended_next_step,
       ec.confidence_score,
       rr.route_type,
       ti.id AS triage_item_id,
       ti.status AS triage_status
     FROM classification_runs cr
     JOIN inbound_emails ie ON ie.id = cr.inbound_email_id
     LEFT JOIN email_classifications ec
       ON ec.classification_run_id = cr.id AND ec.is_current = true
     LEFT JOIN routing_recommendations rr
       ON rr.classification_id = ec.id AND rr.is_current = true
     LEFT JOIN LATERAL (
       SELECT id, status
       FROM triage_items
       WHERE inbound_email_id = cr.inbound_email_id
       ORDER BY created_at DESC
       LIMIT 1
     ) ti ON true
     ORDER BY cr.started_at DESC
     LIMIT $1`,
    [limit]
  );

  console.log(`[dashboard/agent] DB fetch completed runs=${rows.length}`);
  return rows.map(serialize);
}
