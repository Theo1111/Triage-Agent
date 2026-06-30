import type { ReactNode } from "react";
import { query } from "@/src/lib/db";
import type { TriageItem } from "@/src/types/database";
import type { SerializedTriageItem } from "./types";
import TriageTable from "./TriageTable";
import styles from "./dashboard.module.css";

// Always fetch fresh — this is a live triage queue.
export const dynamic = "force-dynamic";

// ── Serialization ─────────────────────────────────────────────────────────────
// pg returns Date objects; Next.js can't serialize them across the server →
// client boundary, so we convert to ISO strings before passing as props.

function toISO(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function serialize(item: TriageItem): SerializedTriageItem {
  return {
    id: item.id,
    inbound_email_id: item.inbound_email_id,
    classification_id: item.classification_id,
    source_inbox_email: item.source_inbox_email,
    sender_email: item.sender_email,
    sender_name: item.sender_name,
    subject: item.subject,
    summary: item.summary,
    urgency_level: item.urgency_level,
    sensitivity_level: item.sensitivity_level,
    route_type: item.route_type,
    owner: item.owner,
    status: item.status,
    recommended_next_step: item.recommended_next_step,
    slack_channel: item.slack_channel,
    created_at: (item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at)),
    updated_at: (item.updated_at instanceof Date ? item.updated_at.toISOString() : String(item.updated_at)),
    assigned_at: toISO(item.assigned_at),
    resolved_at: toISO(item.resolved_at),
    escalated_at: toISO(item.escalated_at),
  };
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchDashboardData(): Promise<{
  open: SerializedTriageItem[];
  resolvedToday: SerializedTriageItem[];
}> {
  const [openRows, resolvedRows] = await Promise.all([
    // All non-terminal items, urgent-first
    query<TriageItem>(
      `SELECT * FROM triage_items
       WHERE status NOT IN ('resolved', 'ignored')
       ORDER BY
         CASE urgency_level WHEN 'urgent' THEN 0 ELSE 1 END,
         created_at DESC`
    ),
    // Resolved in the current calendar day (UTC)
    query<TriageItem>(
      `SELECT * FROM triage_items
       WHERE status = 'resolved'
         AND resolved_at >= CURRENT_DATE
       ORDER BY resolved_at DESC
       LIMIT 50`
    ),
  ]);

  return {
    open: openRows.map(serialize),
    resolvedToday: resolvedRows.map(serialize),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ageMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

// ── Sub-components (server-only, no interactivity) ────────────────────────────

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
  if (alert) cls += ` ${styles.statAlert}`;
  if (positive) cls += ` ${styles.statPositive}`;
  return (
    <div className={cls}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function Section({
  title,
  urgentBadge,
  count,
  children,
}: {
  title: string;
  urgentBadge?: boolean;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        {urgentBadge && (
          <span className={`${styles.badge} ${styles.badgeUrgent}`}>urgent</span>
        )}
        {title}
        <span className={styles.sectionCount}>{count}</span>
      </h2>
      {children}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  let open: SerializedTriageItem[] = [];
  let resolvedToday: SerializedTriageItem[] = [];
  let dbError: string | null = null;

  try {
    const data = await fetchDashboardData();
    open = data.open;
    resolvedToday = data.resolvedToday;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown database error";
  }

  // Section groupings
  const urgentOpen       = open.filter(i => i.urgency_level === "urgent" && i.status === "new");
  const assignedEscalated = open.filter(i => i.status === "assigned" || i.status === "escalated");
  const manualReview     = open.filter(i => i.status === "manual_review");
  const allNew           = open.filter(i => i.status === "new");

  // Oldest unresolved (any new item)
  const oldestNew = allNew.length > 0
    ? allNew.reduce((a, b) =>
        new Date(a.created_at) < new Date(b.created_at) ? a : b
      )
    : null;
  const oldestMs = oldestNew ? ageMs(oldestNew.created_at) : 0;

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Triage Dashboard</h1>
          <p className={styles.subtitle}>
            Week 1 Ops Intelligence — Customer Success Escalation
          </p>
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
        <StatCard label="Total Open" value={open.length} />
        <StatCard
          label="Urgent Open"
          value={urgentOpen.length}
          alert={urgentOpen.length > 0}
        />
        <StatCard
          label="Manual Review"
          value={manualReview.length}
          alert={manualReview.length > 0}
        />
        <StatCard
          label="Resolved Today"
          value={resolvedToday.length}
          positive
        />
        <StatCard
          label="Oldest Unresolved"
          value={oldestNew ? formatAge(oldestMs) : "—"}
          alert={oldestMs > 86_400_000}
        />
      </div>

      {/* Section 1: Urgent open (status=new, urgency=urgent) */}
      <Section title="Urgent Open Items" urgentBadge count={urgentOpen.length}>
        {urgentOpen.length === 0 ? (
          <p className={styles.empty}>No urgent open items — all clear.</p>
        ) : (
          <TriageTable items={urgentOpen} />
        )}
      </Section>

      {/* Section 2: Assigned + escalated */}
      <Section title="Assigned / Escalated" count={assignedEscalated.length}>
        {assignedEscalated.length === 0 ? (
          <p className={styles.empty}>No items currently assigned or escalated.</p>
        ) : (
          <TriageTable items={assignedEscalated} />
        )}
      </Section>

      {/* Section 3: Manual review */}
      <Section title="Manual Review" count={manualReview.length}>
        {manualReview.length === 0 ? (
          <p className={styles.empty}>No items awaiting manual review.</p>
        ) : (
          <TriageTable items={manualReview} />
        )}
      </Section>

      {/* Section 4: Resolved today */}
      <Section title="Resolved Today" count={resolvedToday.length}>
        {resolvedToday.length === 0 ? (
          <p className={styles.empty}>Nothing resolved today yet.</p>
        ) : (
          <TriageTable items={resolvedToday} showResolved />
        )}
      </Section>
    </div>
  );
}
