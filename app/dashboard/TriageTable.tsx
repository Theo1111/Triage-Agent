"use client";

import { useState, useEffect } from "react";
import type { SerializedTriageItem } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import DetailDrawer from "./DetailDrawer";

interface Props {
  items: SerializedTriageItem[];
}

// ── Badge class helpers ──────────────────────────────────────────────────────

const URGENCY_CLASS: Record<string, string> = {
  urgent:       styles.badgeUrgent,
  normal:       styles.badgeNormal,
  not_relevant: styles.badgeNotRelevant,
  unknown:      styles.badgeUnknown,
};
const STATUS_CLASS: Record<string, string> = {
  new:           styles.statusNew,
  assigned:      styles.statusAssigned,
  escalated:     styles.statusEscalated,
  manual_review: styles.statusManualReview,
  resolved:      styles.statusResolved,
  ignored:       styles.statusIgnored,
  archived:      styles.statusArchived,
};
const SENS_CLASS: Record<string, string> = {
  public_internal: styles.sensPublicInternal,
  private:         styles.sensPrivate,
  sensitive:       styles.sensSensitive,
  unknown:         styles.sensUnknown,
};
const ROUTE_CLASS: Record<string, string> = {
  slack_channel:  styles.routeSlack,
  private_owner:  styles.routePrivate,
  dashboard_only: styles.routeDashboard,
  manual_review:  styles.routeManualReview,
  ignore:         styles.routeIgnore,
};
const ROUTE_LABEL: Record<string, string> = {
  slack_channel:  "Slack",
  private_owner:  "Private",
  dashboard_only: "Dashboard",
  manual_review:  "Manual Review",
  ignore:         "Ignore",
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

// ── Operator storage ─────────────────────────────────────────────────────────
// Stores the current operator's username in localStorage so dashboard actions
// are attributed correctly in audit logs and Slack cards.

const OPERATOR_KEY = "triage_dashboard_operator";

function loadOperator(): string {
  try {
    return localStorage.getItem(OPERATOR_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveOperator(name: string) {
  try {
    localStorage.setItem(OPERATOR_KEY, name);
  } catch {}
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TriageTable({ items: initialItems }: Props) {
  const [items, setItems] = useState(initialItems);
  const [selectedItem, setSelectedItem] = useState<SerializedTriageItem | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [operator, setOperator] = useState<string>("");

  // Load saved operator on mount
  useEffect(() => {
    setOperator(loadOperator());
  }, []);

  function getOperator(): string {
    if (operator) return operator;
    const name = window.prompt(
      "Enter your name or username to track dashboard actions (e.g., tblumberg):"
    );
    const trimmed = (name ?? "").trim() || "dashboard";
    setOperator(trimmed);
    saveOperator(trimmed);
    return trimmed;
  }

  function changeOperator() {
    const name = window.prompt("Change operator name:", operator);
    if (name !== null) {
      const trimmed = name.trim() || "dashboard";
      setOperator(trimmed);
      saveOperator(trimmed);
    }
  }

  // Calls a /api/dashboard/triage/* route, updates item state on success
  async function quickAction(
    id: string,
    endpoint: string,
    body: Record<string, unknown> = {}
  ) {
    const actorName = getOperator();
    setLoadingId(id);
    setErrors(prev => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/dashboard/triage/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageItemId: id, actor: actorName, ...body }),
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
        const updated = json.triageItem;
        setItems(prev => prev.map(i => (i.id === id ? { ...i, ...updated } : i)));
        if (selectedItem?.id === id) setSelectedItem(prev => prev ? { ...prev, ...updated } : prev);
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
    const actorName = getOperator();
    const owner = window.prompt(`Assign to (name or username):`);
    if (owner?.trim()) await quickAction(id, "assign", { owner: owner.trim(), actor: actorName });
  }

  function handleItemUpdated(updated: SerializedTriageItem) {
    setItems(prev => prev.map(i => (i.id === updated.id ? { ...i, ...updated } : i)));
    setSelectedItem(prev => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
  }

  if (items.length === 0) {
    return <p className={styles.empty}>No items match the current filter.</p>;
  }

  return (
    <>
      {/* Operator bar */}
      <div className={styles.operatorBar}>
        <span className={styles.operatorLabel}>
          Operator:
        </span>
        <button className={styles.operatorBtn} onClick={changeOperator}>
          {operator || "Set your name…"}
        </button>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Subject</th>
              <th>Sender</th>
              <th>Category</th>
              <th>Summary</th>
              <th>Age</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const ms = ageMs(item.created_at);
              const isSelected = selectedItem?.id === item.id;
              const isLoading = loadingId === item.id;
              return (
                <tr
                  key={item.id}
                  className={[
                    item.urgency_level === "urgent" ? styles.rowUrgent : styles.rowNormal,
                    isSelected ? styles.rowSelected : "",
                  ].join(" ")}
                  onClick={() => setSelectedItem(isSelected ? null : item)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Status badges */}
                  <td onClick={e => e.stopPropagation()}>
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${URGENCY_CLASS[item.urgency_level] ?? styles.badgeUnknown}`}>
                        {item.urgency_level}
                      </span>
                      <span className={`${styles.badge} ${STATUS_CLASS[item.status] ?? styles.statusNew}`}>
                        {item.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </td>

                  {/* Subject */}
                  <td className={styles.subjectCell} title={item.subject ?? ""}>
                    <a
                      href={`/emails/${item.inbound_email_id}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      onClick={e => e.stopPropagation()}
                    >
                      {item.subject ?? <em className={styles.muted}>No subject</em>}
                    </a>
                  </td>

                  {/* Sender */}
                  <td className={styles.senderCell}>
                    {item.sender_name && (
                      <div className={styles.senderName}>{item.sender_name}</div>
                    )}
                    <div className={styles.senderEmail}>{item.sender_email ?? "—"}</div>
                  </td>

                  {/* Category */}
                  <td className={styles.categoryCell}>
                    {item.primary_category ? (
                      <span className={`${styles.badge} ${styles.badgeCategory}`}>
                        {formatCategoryLabel(item.primary_category)}
                      </span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>

                  {/* Summary */}
                  <td
                    className={styles.summaryCell}
                    title={item.summary ?? ""}
                  >
                    {item.summary ?? <em className={styles.muted}>No summary</em>}
                    {item.recommended_next_step && (
                      <span className={styles.nextStep}>
                        → {item.recommended_next_step}
                      </span>
                    )}
                  </td>

                  {/* Age */}
                  <td className={styles.ageCell}>
                    <span className={ageClass(ms)}>{ageString(ms)}</span>
                    <div className={styles.updatedAt}>{fmtDate(item.updated_at)}</div>
                  </td>

                  {/* Inline actions */}
                  <td className={styles.actionsCell} onClick={e => e.stopPropagation()}>
                    <div className={styles.actionBtns}>
                      {item.status !== "resolved" && item.status !== "archived" && (
                        <>
                          {item.status !== "assigned" && item.status !== "escalated" ? (
                            <button
                              className={`${styles.btn} ${styles.btnAssign}`}
                              onClick={() => handleAssign(item.id)}
                              disabled={isLoading}
                            >
                              Assign
                            </button>
                          ) : (
                            <button
                              className={`${styles.btn} ${styles.btnAssign}`}
                              onClick={() => quickAction(item.id, "unassign")}
                              disabled={isLoading}
                            >
                              Unassign
                            </button>
                          )}
                          {item.status !== "escalated" && (
                            <button
                              className={`${styles.btn} ${styles.btnEscalate}`}
                              onClick={() => quickAction(item.id, "escalate")}
                              disabled={isLoading}
                            >
                              Escalate
                            </button>
                          )}
                          <button
                            className={`${styles.btn} ${styles.btnResolve}`}
                            onClick={() => quickAction(item.id, "resolve")}
                            disabled={isLoading}
                          >
                            Resolve
                          </button>
                        </>
                      )}
                      {item.status === "resolved" && (
                        <button
                          className={`${styles.btn} ${styles.btnReopen}`}
                          onClick={() => quickAction(item.id, "reopen")}
                          disabled={isLoading}
                        >
                          Reopen
                        </button>
                      )}
                      {item.status !== "archived" && (
                        <button
                          className={`${styles.btn} ${styles.btnArchive}`}
                          onClick={() => quickAction(item.id, "archive", { archivedBy: operator || "dashboard" })}
                          disabled={isLoading}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                    {errors[item.id] && (
                      <div className={styles.actionError}>{errors[item.id]}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DetailDrawer
        item={selectedItem}
        operator={operator}
        onClose={() => setSelectedItem(null)}
        onItemUpdated={handleItemUpdated}
        onOperatorChange={(name) => { setOperator(name); saveOperator(name); }}
      />
    </>
  );
}
