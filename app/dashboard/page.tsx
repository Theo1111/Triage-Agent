import { Suspense } from "react";
import { query } from "@/src/lib/db";
import type { TriageItem } from "@/src/types/database";
import type { SerializedTriageItem, TabCounts } from "./types";
import DashboardClient from "./DashboardClient";
import styles from "./dashboard.module.css";
import { TEAM_CATEGORIES } from "@/src/config/roles";

export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────────

type ExtendedRow = TriageItem & {
  primary_category: string | null;
  urgency_reason: string | null;
};

// ── Serialization ──────────────────────────────────────────────────────────────

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

// ── Data fetching ──────────────────────────────────────────────────────────────

// Returns all recent items across every status so DashboardClient can filter
// client-side — giving instant tab switches without network round-trips.
async function fetchAllItems(): Promise<SerializedTriageItem[]> {
  const rows = await query<ExtendedRow>(
    `SELECT ti.*,
            ec.primary_category,
            ec.urgency_reason
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id
     ORDER BY
       CASE ti.urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
       ti.created_at DESC
     LIMIT 500`,
    []
  );
  return rows.map(serialize);
}

async function fetchTabCounts(): Promise<TabCounts> {
  const [row] = await query<Record<string, string>>(
    `SELECT
       COUNT(*) FILTER (WHERE ti.status NOT IN ('resolved','archived','ignored'))                                          AS "all",
       COUNT(*) FILTER (WHERE ti.urgency_level='urgent' AND ti.status NOT IN ('resolved','archived','ignored'))           AS urgent_open,
       COUNT(*) FILTER (WHERE ti.status IN ('assigned','escalated'))                                                      AS assigned,
       COUNT(*) FILTER (WHERE ti.status = 'manual_review')                                                               AS manual_review,
       COUNT(*) FILTER (WHERE ti.status = 'resolved')                                                                    AS resolved,
       COUNT(*) FILTER (WHERE ti.status = 'archived')                                                                    AS archived,
       COUNT(*) FILTER (WHERE ec.primary_category = ANY($1::text[]) AND ti.status NOT IN ('resolved','archived','ignored')) AS operations,
       COUNT(*) FILTER (WHERE ec.primary_category = ANY($2::text[]) AND ti.status NOT IN ('resolved','archived','ignored')) AS engineering,
       COUNT(*) FILTER (WHERE ec.primary_category = ANY($3::text[]) AND ti.status NOT IN ('resolved','archived','ignored')) AS customer_success,
       COUNT(*) FILTER (WHERE ec.primary_category = ANY($4::text[]) AND ti.status NOT IN ('resolved','archived','ignored')) AS field_ops
     FROM triage_items ti
     LEFT JOIN email_classifications ec ON ec.id = ti.classification_id`,
    [
      TEAM_CATEGORIES.operations,
      TEAM_CATEGORIES.engineering,
      TEAM_CATEGORIES.customer_success,
      TEAM_CATEGORIES.field_ops,
    ]
  );

  return {
    all:             Number(row?.all ?? 0),
    urgent_open:     Number(row?.urgent_open ?? 0),
    assigned:        Number(row?.assigned ?? 0),
    manual_review:   Number(row?.manual_review ?? 0),
    resolved:        Number(row?.resolved ?? 0),
    archived:        Number(row?.archived ?? 0),
    operations:      Number(row?.operations ?? 0),
    engineering:     Number(row?.engineering ?? 0),
    customer_success: Number(row?.customer_success ?? 0),
    field_ops:       Number(row?.field_ops ?? 0),
  };
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  alert,
  positive,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
  positive?: boolean;
}) {
  let cls = styles.statCard;
  if (alert)    cls += ` ${styles.statAlert}`;
  if (positive) cls += ` ${styles.statPositive}`;
  return (
    <div className={cls}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params       = await searchParams;
  const initialTeam  = params.team   ?? "";
  const initialSearch = params.search ?? "";

  let allItems: SerializedTriageItem[] = [];
  let counts: TabCounts = {
    all: 0, urgent_open: 0, assigned: 0, manual_review: 0,
    operations: 0, engineering: 0, customer_success: 0, field_ops: 0,
    resolved: 0, archived: 0,
  };
  let dbError: string | null = null;

  try {
    [allItems, counts] = await Promise.all([fetchAllItems(), fetchTabCounts()]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown database error";
  }

  const openItems    = allItems.filter(i => !["resolved", "archived", "ignored"].includes(i.status));
  const urgentCount  = counts.urgent_open;
  const oldestOpenMs = openItems.length > 0
    ? Math.max(...openItems.filter(i => i.status === "new").map(i => Date.now() - new Date(i.created_at).getTime()))
    : 0;

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Triage Dashboard</h1>
          <p className={styles.subtitle}>Grata / Speer Operations Intelligence</p>
        </div>
        <a href="/dashboard" className={styles.refreshBtn}>↻ Refresh</a>
      </header>

      {dbError && (
        <div className={styles.errorBox}>
          <strong>Database error:</strong> {dbError}
        </div>
      )}

      {/* Stats */}
      <div className={styles.statsGrid}>
        <StatCard label="Total Open"     value={counts.all} />
        <StatCard label="Urgent Open"    value={urgentCount} alert={urgentCount > 0} />
        <StatCard label="Manual Review"  value={counts.manual_review} alert={counts.manual_review > 0} />
        <StatCard label="Resolved"       value={counts.resolved} positive />
        <StatCard
          label="Oldest Unresolved"
          value={oldestOpenMs > 0 ? formatAge(oldestOpenMs) : "—"}
          alert={oldestOpenMs > 86_400_000}
        />
      </div>

      {/* Filter + table — client-side interactive */}
      <section className={styles.section}>
        <Suspense fallback={<div className={styles.empty}>Loading…</div>}>
          <DashboardClient
            initialItems={allItems}
            counts={counts}
            initialTeam={initialTeam}
            initialSearch={initialSearch}
          />
        </Suspense>
      </section>
    </div>
  );
}
