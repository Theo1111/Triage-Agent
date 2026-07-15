"use client";

import { useMemo, useState } from "react";
import type { SerializedAgentRun } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import { formatTorontoDateTimeShort } from "@/src/lib/formatDate";
import AgentRunDrawer from "./AgentRunDrawer";

interface Props {
  runs: SerializedAgentRun[];
  search: string;
  onSearchChange: (value: string) => void;
}

const URGENCY_CLASS: Record<string, string> = {
  urgent:       styles.badgeUrgent,
  normal:       styles.badgeNormal,
  not_relevant: styles.badgeNotRelevant,
  unknown:      styles.badgeUnknown,
};

const RUN_STATUS_CLASS: Record<string, string> = {
  success:         styles.statusResolved,
  partial_success: styles.statusManualReview,
  failed:          styles.badgeUrgent,
  started:         styles.statusNew,
};

function fmtConfidence(score: number | null): string {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

function confidenceClass(score: number | null): string {
  if (score == null) return styles.muted;
  if (score < 0.7) return styles.ageRed;
  if (score < 0.85) return styles.ageAmber;
  return styles.ageGreen;
}

function filterRuns(runs: SerializedAgentRun[], search: string): SerializedAgentRun[] {
  if (!search.trim()) return runs;
  const q = search.toLowerCase();
  return runs.filter(
    r =>
      r.subject?.toLowerCase().includes(q) ||
      r.sender_email?.toLowerCase().includes(q) ||
      r.sender_name?.toLowerCase().includes(q) ||
      r.summary?.toLowerCase().includes(q) ||
      r.primary_category?.toLowerCase().includes(q) ||
      r.recommended_owner?.toLowerCase().includes(q) ||
      r.error_message?.toLowerCase().includes(q)
  );
}

export default function AgentRunsTable({ runs, search, onSearchChange }: Props) {
  const [selected, setSelected] = useState<SerializedAgentRun | null>(null);
  const filtered = useMemo(() => filterRuns(runs, search), [runs, search]);

  return (
    <>
      <div className={styles.filterBar}>
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search subject, sender, category, owner…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
          <span className={styles.sectionCount}>{filtered.length} runs</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>No agent classification runs match this view.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Subject</th>
                <th>Sender</th>
                <th>Urgency</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Confidence</th>
                <th>Route</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => {
                const urgency = run.urgency_level ?? "unknown";
                return (
                  <tr
                    key={run.id}
                    className={urgency === "urgent" ? styles.rowUrgent : styles.rowNormal}
                    onClick={() => setSelected(run)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className={styles.ageCell}>
                      <div>{formatTorontoDateTimeShort(run.started_at)}</div>
                      {run.model_name && (
                        <div className={styles.updatedAt}>{run.model_name}</div>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${RUN_STATUS_CLASS[run.status] ?? styles.badgeUnknown}`}>
                        {run.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className={styles.subjectCell} title={run.subject ?? undefined}>
                      {run.subject ?? <em className={styles.muted}>No subject</em>}
                      {run.needs_manual_review && (
                        <div className={styles.updatedAt}>Needs manual review</div>
                      )}
                    </td>
                    <td className={styles.senderCell}>
                      <div className={styles.senderName}>{run.sender_name ?? "—"}</div>
                      <div className={styles.senderEmail}>{run.sender_email ?? ""}</div>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${URGENCY_CLASS[urgency] ?? styles.badgeUnknown}`}>
                        {urgency.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>{formatCategoryLabel(run.primary_category)}</td>
                    <td>
                      {run.recommended_owner ? (
                        <span className={styles.ownerTag}>
                          {run.recommended_owner.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={confidenceClass(run.confidence_score)}>
                      {fmtConfidence(run.confidence_score)}
                    </td>
                    <td>
                      {run.route_type
                        ? run.route_type.replace(/_/g, " ")
                        : <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.actionsCell}>
                      <a
                        className={`${styles.btn} ${styles.btnArchive}`}
                        href={`/emails/${run.inbound_email_id}`}
                        onClick={e => e.stopPropagation()}
                      >
                        Email
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AgentRunDrawer run={selected} onClose={() => setSelected(null)} />
    </>
  );
}
