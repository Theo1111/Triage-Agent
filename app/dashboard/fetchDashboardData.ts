import { query } from "@/src/lib/db";
import type { TriageItem } from "@/src/types/database";
import type { SerializedTriageItem } from "./types";

type ExtendedRow = TriageItem & {
  primary_category: string | null;
  urgency_reason: string | null;
  recommended_owner: string | null;
};

type ExtendedRowWithRead = ExtendedRow & {
  has_unread_update: boolean;
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
    archived_reason: row.archived_reason,
    restored_at: toISO(row.restored_at),
    restored_by: row.restored_by,
    primary_category: row.primary_category,
    urgency_reason: row.urgency_reason,
    recommended_owner: row.recommended_owner,
    has_unread_update: false,
  };
}

// ORDER BY clause shared by both variants.
// When operatorId is provided, items with unread updates float above normal urgency sort.
const BASE_ORDER = `
  ORDER BY
    CASE WHEN ti.escalated_at IS NOT NULL AND ti.status NOT IN ('resolved','archived','ignored') THEN 0 ELSE 1 END,
    CASE ti.urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
    ti.created_at DESC`;

const OPERATOR_ORDER = `
  ORDER BY
    CASE WHEN ti.escalated_at IS NOT NULL AND ti.status NOT IN ('resolved','archived','ignored') THEN 0 ELSE 1 END,
    CASE WHEN tior.last_viewed_at IS NOT NULL AND ti.updated_at > tior.last_viewed_at THEN 0 ELSE 1 END,
    CASE ti.urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
    ti.created_at DESC`;

// Fetch items with per-operator unread state. When operatorId is null, all items
// return has_unread_update=false and the sort falls back to the non-operator order.
export async function fetchAllItemsForOperator(
  operatorId: string | null
): Promise<SerializedTriageItem[]> {
  console.log(`[dashboard] DB fetch started operatorId=${operatorId ?? "none"}`);

  if (operatorId) {
    const rows = await query<ExtendedRowWithRead>(
      `SELECT ti.*,
              ec.primary_category,
              ec.urgency_reason,
              ec.recommended_owner,
              CASE
                WHEN tior.last_viewed_at IS NOT NULL AND ti.updated_at > tior.last_viewed_at THEN true
                ELSE false
              END AS has_unread_update
       FROM triage_items ti
       LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
       LEFT JOIN triage_item_operator_reads tior
              ON tior.triage_item_id = ti.id
              AND tior.operator_profile_id = $1::uuid
       ${OPERATOR_ORDER}
       LIMIT 500`,
      [operatorId]
    );
    console.log(`[dashboard] DB fetch completed items=${rows.length}`);
    return rows.map(row => ({ ...serialize(row), has_unread_update: !!row.has_unread_update }));
  }

  const rows = await query<ExtendedRow>(
    `SELECT ti.*,
            ec.primary_category,
            ec.urgency_reason,
            ec.recommended_owner
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
     ${BASE_ORDER}
     LIMIT 500`,
    []
  );
  console.log(`[dashboard] DB fetch completed items=${rows.length}`);
  return rows.map(serialize);
}

// Backward-compat alias for callers that don't have operator context.
export async function fetchAllItems(): Promise<SerializedTriageItem[]> {
  return fetchAllItemsForOperator(null);
}
