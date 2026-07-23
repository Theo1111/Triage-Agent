"use client";

import { useState, useEffect, useCallback } from "react";
import type { SerializedTriageItem, CurrentOperator } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import { formatTorontoDateTime } from "@/src/lib/formatDate";
import { deriveTriageDisplayState } from "@/src/lib/triageDisplayState";
import { resolveOwner, type OperatorLite } from "@/src/lib/ownerDisplay";
import { TEAM_LABELS } from "@/src/config/roles";
import AssignMenu from "./AssignMenu";
import CaseTimelineView from "./CaseTimelineView";

interface Props {
  item: SerializedTriageItem | null;
  operators: OperatorLite[];
  currentOperator: CurrentOperator | null;
  onClose: () => void;
  onItemUpdated: (updated: SerializedTriageItem) => void;
}

function fmtDate(iso: string | null): string {
  return formatTorontoDateTime(iso);
}

export default function DetailDrawer({ item, operators, onClose, onItemUpdated }: Props) {
  const [loading,      setLoading]      = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [editSummary,  setEditSummary]  = useState(false);
  const [summaryInput, setSummaryInput] = useState("");

  // Mark read on open.
  useEffect(() => {
    if (!item) return;
    const id = item.id;
    const hadUnread = item.has_unread_update;
    fetch("/api/dashboard/triage/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triageItemId: id }),
    })
      .then(() => {
        if (hadUnread) onItemUpdated({ ...item, has_unread_update: false });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const callDashboard = useCallback(
    async (endpoint: string, body: Record<string, unknown> = {}): Promise<SerializedTriageItem | null> => {
      if (!item) return null;
      setError(null);
      setLoading(endpoint);
      try {
        const res = await fetch(`/api/dashboard/triage/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triageItemId: item.id, ...body }),
        });
        const json = (await res.json()) as {
          success?: boolean;
          triageItem?: SerializedTriageItem;
          error?: string;
        };
        if (res.status === 401) {
          setError("Session expired — please log in again.");
          return null;
        }
        if (!res.ok || !json.success) {
          setError(json.error ?? `HTTP ${res.status}`);
          return null;
        }
        return json.triageItem ?? null;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      } finally {
        setLoading(null);
      }
    },
    [item]
  );

  async function handleAction(endpoint: string, body: Record<string, unknown> = {}) {
    const updated = await callDashboard(endpoint, body);
    if (updated) onItemUpdated(updated);
  }

  async function handleSaveSummary() {
    await handleAction("update", { summary: summaryInput.trim() || null });
    setEditSummary(false);
    setSummaryInput("");
  }

  if (!item) return null;

  const busy = loading !== null;
  const { isAssigned, isEscalated, isActive, isResolved, isArchived } = deriveTriageDisplayState(item);
  const owner = resolveOwner(item.owner, operators);

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawerPanel}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>{item.subject ?? <em>No subject</em>}</div>
          <button className={styles.drawerClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className={styles.drawerError}>{error}</div>}

        {/* Actions */}
        <div className={styles.drawerActions}>
          {isActive && (
            <>
              <AssignMenu
                operators={operators}
                isAssigned={isAssigned}
                busy={busy}
                label={isAssigned ? "Reassign" : "Assign"}
                onAssignSelf={() => handleAction("assign", { ownerKind: "self" })}
                onAssignOperator={u => handleAction("assign", { ownerKind: "operator", owner: u })}
                onAssignTeam={t => handleAction("assign", { ownerKind: "team", owner: t })}
                onUnassign={() => handleAction("unassign")}
              />
              {isEscalated ? (
                <button className={styles.drawerBtn} onClick={() => handleAction("unescalate")} disabled={busy}>
                  {loading === "unescalate" ? "…" : "↘️ Unescalate"}
                </button>
              ) : (
                <button className={styles.drawerBtn} onClick={() => handleAction("escalate")} disabled={busy}>
                  {loading === "escalate" ? "…" : "🔺 Escalate"}
                </button>
              )}
              <button
                className={styles.drawerBtn}
                onClick={() => {
                  if (window.confirm("Resolve this case? It will leave the active queue.")) handleAction("resolve");
                }}
                disabled={busy}
              >
                {loading === "resolve" ? "…" : "🟢 Resolve"}
              </button>
            </>
          )}
          {isResolved && (
            <button className={styles.drawerBtn} onClick={() => handleAction("reopen")} disabled={busy}>
              {loading === "reopen" ? "…" : "🔄 Reopen"}
            </button>
          )}
          {isArchived ? (
            <button className={styles.drawerBtn} onClick={() => handleAction("unarchive")} disabled={busy}>
              {loading === "unarchive" ? "…" : "↩️ Restore"}
            </button>
          ) : (
            <button
              className={`${styles.drawerBtn} ${styles.drawerBtnDanger}`}
              onClick={() => {
                if (window.confirm("Archive this case? It will leave the active queue.")) handleAction("archive");
              }}
              disabled={busy}
            >
              {loading === "archive" ? "…" : "🗄️ Archive"}
            </button>
          )}
          <a className={`${styles.drawerBtn} ${styles.drawerBtnLink}`} href={`/emails/${item.inbound_email_id}`}>
            📬 View Email
          </a>
        </div>

        {/* Email info */}
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Email</div>
          <DrawerField label="From">
            {item.sender_name ? `${item.sender_name} ` : ""}
            <span className={styles.drawerMuted}>{item.sender_email ?? "—"}</span>
          </DrawerField>
          <DrawerField label="To">{item.source_inbox_email}</DrawerField>
          <DrawerField label="Received">{fmtDate(item.created_at)}</DrawerField>
          <DrawerField label="Category">{formatCategoryLabel(item.primary_category)}</DrawerField>
        </div>

        {/* AI Classification */}
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>AI Classification</div>
          <DrawerField label="Urgency">{item.urgency_level}</DrawerField>
          {item.urgency_reason && <DrawerField label="Reason">{item.urgency_reason}</DrawerField>}
          <DrawerField label="Sensitivity">{item.sensitivity_level.replace(/_/g, " ")}</DrawerField>

          <div className={styles.drawerField}>
            <span className={styles.drawerLabel}>Summary</span>
            {editSummary ? (
              <div className={styles.drawerEditGroup}>
                <textarea
                  className={styles.drawerTextarea}
                  value={summaryInput}
                  onChange={e => setSummaryInput(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className={styles.drawerEditActions}>
                  <button className={styles.drawerBtnSm} onClick={handleSaveSummary} disabled={busy}>Save</button>
                  <button className={styles.drawerBtnSmCancel} onClick={() => { setEditSummary(false); setSummaryInput(""); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <span
                className={`${styles.drawerValue} ${styles.drawerEditable}`}
                onClick={() => { setEditSummary(true); setSummaryInput(item.summary ?? ""); }}
                title="Click to edit"
              >
                {item.summary ?? <em className={styles.drawerMuted}>None — click to add</em>}
              </span>
            )}
          </div>

          {item.recommended_next_step && <DrawerField label="Next step">{item.recommended_next_step}</DrawerField>}
        </div>

        {/* Triage status */}
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Triage</div>
          <DrawerField label="Status">{item.status.replace(/_/g, " ")}</DrawerField>
          <DrawerField label="Owner">
            {owner.kind === "unassigned" ? (
              <span className={styles.drawerMuted}>
                Unassigned
                {item.recommended_owner && (
                  <> — suggested: {TEAM_LABELS[item.recommended_owner] ?? formatCategoryLabel(item.recommended_owner)}</>
                )}
              </span>
            ) : (
              owner.label
            )}
          </DrawerField>
          <DrawerField label="Route">{item.route_type.replace(/_/g, " ")}</DrawerField>
          {item.assigned_at && <DrawerField label="Assigned">{fmtDate(item.assigned_at)}</DrawerField>}
          {item.resolved_at && <DrawerField label="Resolved">{fmtDate(item.resolved_at)}</DrawerField>}
          {item.archived_at && (
            <DrawerField label="Archived">
              {fmtDate(item.archived_at)} by {item.archived_by ?? "—"}
              {item.archived_reason && <span className={styles.drawerMuted}> — {item.archived_reason}</span>}
            </DrawerField>
          )}
          {item.restored_at && (
            <DrawerField label="Restored">{fmtDate(item.restored_at)} by {item.restored_by ?? "—"}</DrawerField>
          )}
          {item.slack_channel && (
            <DrawerField label="Slack">
              <span className={styles.drawerMuted}>
                {item.slack_channel}
                {item.slack_message_ts ? ` · ts ${item.slack_message_ts}` : ""}
              </span>
            </DrawerField>
          )}
        </div>

        {/* Activity timeline + thread messages */}
        <CaseTimelineView triageItemId={item.id} />
      </div>
    </>
  );
}

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.drawerField}>
      <span className={styles.drawerLabel}>{label}</span>
      <span className={styles.drawerValue}>{children}</span>
    </div>
  );
}
