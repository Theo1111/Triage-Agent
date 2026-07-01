"use client";

import { useState } from "react";
import type { SerializedTriageItem } from "./types";
import styles from "./dashboard.module.css";

interface Props {
  items: SerializedTriageItem[];
  showResolved?: boolean;
}

// ── Badge class helpers (static names required for CSS modules) ─────────────

const URGENCY_CLASS: Record<string, string> = {
  urgent:      styles.badgeUrgent,
  normal:      styles.badgeNormal,
  not_relevant: styles.badgeNotRelevant,
  unknown:     styles.badgeUnknown,
};
const STATUS_CLASS: Record<string, string> = {
  new:           styles.statusNew,
  assigned:      styles.statusAssigned,
  escalated:     styles.statusEscalated,
  manual_review: styles.statusManualReview,
  resolved:      styles.statusResolved,
  ignored:       styles.statusIgnored,
};
const SENS_CLASS: Record<string, string> = {
  public_internal: styles.sensPublicInternal,
  private:         styles.sensPrivate,
  sensitive:       styles.sensSensitive,
  unknown:         styles.sensUnknown,
};
const ROUTE_CLASS: Record<string, string> = {
  slack_channel: styles.routeSlack,
  private_owner: styles.routePrivate,
  dashboard_only: styles.routeDashboard,
  manual_review: styles.routeManualReview,
  ignore:        styles.routeIgnore,
};
const ROUTE_LABEL: Record<string, string> = {
  slack_channel:  "Slack",
  private_owner:  "Private",
  dashboard_only: "Dashboard",
  manual_review:  "Manual Review",
  ignore:         "Ignore",
};
const ROW_CLASS: Record<string, string> = {
  urgent: styles.rowUrgent,
  normal: styles.rowNormal,
};

// ── Date helpers ─────────────────────────────────────────────────────────────

function ageMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

function ageString(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function ageClass(ms: number): string {
  if (ms < 2 * 3_600_000)  return styles.ageGreen;
  if (ms < 24 * 3_600_000) return styles.ageAmber;
  if (ms < 3 * 86_400_000) return styles.ageOrange;
  return styles.ageRed;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TriageTable({ items: initialItems, showResolved }: Props) {
  const [items, setItems] = useState(initialItems);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function callApi(
    id: string,
    endpoint: "assign" | "resolve" | "escalate",
    owner?: string
  ) {
    setLoadingId(id);
    setErrors(prev => ({ ...prev, [id]: "" }));
    try {
      const body: Record<string, string> = { triageItemId: id };
      if (owner) body.owner = owner;
      const res = await fetch(`/api/triage/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        success?: boolean;
        triageItem?: SerializedTriageItem;
        error?: string;
      };
      if (!res.ok || !json.success) {
        setErrors(prev => ({ ...prev, [id]: json.error ?? `HTTP ${res.status}` }));
        return;
      }
      if (json.triageItem) {
        setItems(prev =>
          prev.map(i => (i.id === id ? { ...i, ...json.triageItem } : i))
        );
      }
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleAssign(id: string) {
    const owner = window.prompt("Assign to (name or email):");
    if (owner?.trim()) await callApi(id, "assign", owner.trim());
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Urgency / Status</th>
            <th>Subject</th>
            <th>Sender</th>
            <th>Source Inbox</th>
            <th>Summary / Next Step</th>
            <th>Owner</th>
            <th>Route</th>
            <th>Sensitivity</th>
            <th>Age</th>
            {showResolved ? <th>Resolved At</th> : <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const ms = ageMs(item.created_at);
            return (
              <tr
                key={item.id}
                className={ROW_CLASS[item.urgency_level] ?? ""}
              >
                {/* Urgency + Status badges */}
                <td>
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${URGENCY_CLASS[item.urgency_level] ?? styles.badgeUnknown}`}>
                      {item.urgency_level}
                    </span>
                    <span className={`${styles.badge} ${STATUS_CLASS[item.status] ?? styles.statusNew}`}>
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </td>

                {/* Subject — links to email detail page */}
                <td className={styles.subjectCell} title={item.subject ?? ""}>
                  <a href={`/emails/${item.inbound_email_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {item.subject ?? <em className={styles.muted}>No subject</em>}
                  </a>
                </td>

                {/* Sender */}
                <td className={styles.senderCell}>
                  {item.sender_name && (
                    <div className={styles.senderName}>{item.sender_name}</div>
                  )}
                  <div className={styles.senderEmail}>
                    {item.sender_email ?? "—"}
                  </div>
                </td>

                {/* Source inbox */}
                <td className={styles.inboxCell}>{item.source_inbox_email}</td>

                {/* Summary + recommended next step */}
                <td
                  className={styles.summaryCell}
                  title={[item.summary, item.recommended_next_step]
                    .filter(Boolean)
                    .join("\n\n→ ")}
                >
                  {item.summary ?? <em className={styles.muted}>No summary</em>}
                  {item.recommended_next_step && (
                    <span className={styles.nextStep}>
                      → {item.recommended_next_step}
                    </span>
                  )}
                </td>

                {/* Owner */}
                <td>
                  {item.owner ? (
                    <span className={styles.ownerTag}>{item.owner}</span>
                  ) : (
                    <span className={styles.muted}>unassigned</span>
                  )}
                </td>

                {/* Route type */}
                <td>
                  <span className={`${styles.badge} ${ROUTE_CLASS[item.route_type] ?? styles.routeDashboard}`}>
                    {ROUTE_LABEL[item.route_type] ?? item.route_type}
                  </span>
                </td>

                {/* Sensitivity */}
                <td>
                  <span className={`${styles.badge} ${SENS_CLASS[item.sensitivity_level] ?? styles.sensUnknown}`}>
                    {item.sensitivity_level.replace(/_/g, " ")}
                  </span>
                </td>

                {/* Age */}
                <td className={styles.ageCell}>
                  <span className={ageClass(ms)}>{ageString(ms)}</span>
                  <div className={styles.updatedAt}>upd {fmtDate(item.updated_at)}</div>
                </td>

                {/* Actions or resolved-at */}
                {showResolved ? (
                  <td>{fmtDate(item.resolved_at)}</td>
                ) : (
                  <td className={styles.actionsCell}>
                    <div className={styles.actionBtns}>
                      <button
                        className={`${styles.btn} ${styles.btnAssign}`}
                        onClick={() => handleAssign(item.id)}
                        disabled={loadingId === item.id}
                      >
                        Assign
                      </button>
                      {item.status !== "escalated" && (
                        <button
                          className={`${styles.btn} ${styles.btnEscalate}`}
                          onClick={() => callApi(item.id, "escalate")}
                          disabled={loadingId === item.id}
                        >
                          Escalate
                        </button>
                      )}
                      <button
                        className={`${styles.btn} ${styles.btnResolve}`}
                        onClick={() => callApi(item.id, "resolve")}
                        disabled={loadingId === item.id}
                      >
                        Resolve
                      </button>
                    </div>
                    {errors[item.id] && (
                      <div className={styles.actionError}>{errors[item.id]}</div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
