import { query } from "@/src/lib/db";
import type { TriageItem } from "@/src/types/database";
import type { SerializedTriageItem } from "./types";

type ExtendedRow = TriageItem & {
  primary_category: string | null;
  urgency_reason: string | null;
};

function toISO(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function serialize(row: ExtendedRow): SerializedTriageItem {
  return {
    id: row.id,
    inbound_email_id: row.inbound_email_id,
    classification_id: row.classification_id,
    source_inbox_email: row.source_inbox_email,
    sender_email: row.sender_email,
    sender_name: row.sender_name,
    subject: row.subject,
    summary: row.summary,
    urgency_level: row.urgency_level,
    sensitivity_level: row.sensitivity_level,
    route_type: row.route_type,
    owner: row.owner,
    status: row.status,
    recommended_next_step: row.recommended_next_step,
    slack_channel: row.slack_channel,
    slack_message_ts: row.slack_message_ts,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    assigned_at: toISO(row.assigned_at),
    resolved_at: toISO(row.resolved_at),
    escalated_at: toISO(row.escalated_at),
    archived_at: toISO(row.archived_at),
    archived_by: row.archived_by,
    primary_category: row.primary_category,
    urgency_reason: row.urgency_reason,
  };
}

// Single query — items already include primary_category via JOIN so counts can be
// derived client-side without a second round-trip.
export async function fetchAllItems(): Promise<SerializedTriageItem[]> {
  console.log("[dashboard] DB fetch started");
  const rows = await query<ExtendedRow>(
    `SELECT ti.*,
            ec.primary_category,
            ec.urgency_reason
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
     ORDER BY
       CASE WHEN ti.escalated_at IS NOT NULL AND ti.status NOT IN ('resolved','archived','ignored') THEN 0 ELSE 1 END,
       CASE ti.urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
       ti.created_at DESC
     LIMIT 500`,
    []
  );
  console.log(`[dashboard] DB fetch completed items=${rows.length}`);
  return rows.map(serialize);
}
