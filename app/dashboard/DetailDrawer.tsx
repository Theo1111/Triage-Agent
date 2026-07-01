"use client";

import { useState } from "react";
import type { SerializedTriageItem } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";

interface Props {
  item: SerializedTriageItem | null;
  operator: string;
  onClose: () => void;
  onItemUpdated: (updated: SerializedTriageItem) => void;
  onOperatorChange: (name: string) => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function DetailDrawer({
  item,
  operator,
  onClose,
  onItemUpdated,
  onOperatorChange,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOwner, setEditOwner] = useState(false);
  const [ownerInput, setOwnerInput] = useState("");
  const [editSummary, setEditSummary] = useState(false);
  const [summaryInput, setSummaryInput] = useState("");

  if (!item) return null;

  function getActor(): string {
    if (operator) return operator;
    const name = window.prompt(
      "Enter your name or username to track this action (e.g., tblumberg):"
    );
    const trimmed = (name ?? "").trim() || "dashboard";
    onOperatorChange(trimmed);
    return trimmed;
  }

  async function callDashboard(
    endpoint: string,
    body: Record<string, unknown> = {}
  ): Promise<SerializedTriageItem | null> {
    setError(null);
    setLoading(endpoint);
    const actorName = getActor();
    try {
      const res = await fetch(`/api/dashboard/triage/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageItemId: item!.id, actor: actorName, ...body }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        triageItem?: SerializedTriageItem;
        error?: string;
      };
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
  }

  async function handleAction(endpoint: string, body: Record<string, unknown> = {}) {
    const updated = await callDashboard(endpoint, body);
    if (updated) onItemUpdated(updated);
  }

  async function handleAssign() {
    const owner = window.prompt("Assign to (name or username):");
    if (owner?.trim()) await handleAction("assign", { owner: owner.trim() });
  }

  async function handleSaveOwner() {
    if (ownerInput.trim()) {
      await handleAction("assign", { owner: ownerInput.trim() });
      setEditOwner(false);
      setOwnerInput("");
    }
  }

  async function handleSaveSummary() {
    await handleAction("update", { summary: summaryInput.trim() || null });
    setEditSummary(false);
    setSummaryInput("");
  }

  const busy = loading !== null;
  const isActive = item.status !== "resolved" && item.status !== "archived";
  const isAssigned = item.status === "assigned" || item.status === "escalated";
  const viewEmailUrl = `/emails/${item.inbound_email_id}`;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawerPanel}>
        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            {item.subject ?? <em>No subject</em>}
          </div>
          <button className={styles.drawerClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <div className={styles.drawerError}>{error}</div>}

        {/* Actions */}
        <div className={styles.drawerActions}>
          {isActive && (
            <>
              <button
                className={`${styles.drawerBtn} ${styles.drawerBtnPrimary}`}
                onClick={handleAssign}
                disabled={busy}
              >
                {loading === "assign" ? "…" : "✅ Assign"}
              </button>
              {isAssigned && (
                <button
                  className={styles.drawerBtn}
                  onClick={() => handleAction("unassign")}
                  disabled={busy}
                >
                  {loading === "unassign" ? "…" : "↩️ Unassign"}
                </button>
              )}
              {!isAssigned && (
                <button
                  className={styles.drawerBtn}
                  onClick={() => handleAction("escalate")}
                  disabled={busy}
                >
                  {loading === "escalate" ? "…" : "🔺 Escalate"}
                </button>
              )}
              <button
                className={styles.drawerBtn}
                onClick={() => handleAction("resolve")}
                disabled={busy}
              >
                {loading === "resolve" ? "…" : "🟢 Resolve"}
              </button>
            </>
          )}
          {item.status === "resolved" && (
            <button
              className={styles.drawerBtn}
              onClick={() => handleAction("reopen")}
              disabled={busy}
            >
              {loading === "reopen" ? "…" : "🔄 Reopen"}
            </button>
          )}
          {item.status !== "archived" && (
            <button
              className={`${styles.drawerBtn} ${styles.drawerBtnDanger}`}
              onClick={() => handleAction("archive", { archivedBy: operator || "dashboard" })}
              disabled={busy}
            >
              {loading === "archive" ? "…" : "🗄️ Archive"}
            </button>
          )}
          <a className={`${styles.drawerBtn} ${styles.drawerBtnLink}`} href={viewEmailUrl}>
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
          <DrawerField label="Category">
            {formatCategoryLabel(item.primary_category)}
          </DrawerField>
        </div>

        {/* Classification */}
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>AI Classification</div>
          <DrawerField label="Urgency">{item.urgency_level}</DrawerField>
          {item.urgency_reason && (
            <DrawerField label="Reason">{item.urgency_reason}</DrawerField>
          )}
          <DrawerField label="Sensitivity">
            {item.sensitivity_level.replace(/_/g, " ")}
          </DrawerField>
          {/* Editable summary */}
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
                  <button className={styles.drawerBtnSm} onClick={handleSaveSummary} disabled={busy}>
                    Save
                  </button>
                  <button
                    className={styles.drawerBtnSmCancel}
                    onClick={() => { setEditSummary(false); setSummaryInput(""); }}
                  >
                    Cancel
                  </button>
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
          {item.recommended_next_step && (
            <DrawerField label="Next step">{item.recommended_next_step}</DrawerField>
          )}
        </div>

        {/* Triage status */}
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>Triage</div>
          <DrawerField label="Status">{item.status.replace(/_/g, " ")}</DrawerField>
          {/* Editable owner */}
          <div className={styles.drawerField}>
            <span className={styles.drawerLabel}>Owner</span>
            {editOwner ? (
              <div className={styles.drawerEditGroup}>
                <input
                  type="text"
                  className={styles.drawerInput}
                  value={ownerInput}
                  onChange={e => setOwnerInput(e.target.value)}
                  placeholder="Name or username"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleSaveOwner(); }}
                />
                <div className={styles.drawerEditActions}>
                  <button className={styles.drawerBtnSm} onClick={handleSaveOwner} disabled={busy}>
                    Save
                  </button>
                  <button
                    className={styles.drawerBtnSmCancel}
                    onClick={() => { setEditOwner(false); setOwnerInput(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <span
                className={`${styles.drawerValue} ${styles.drawerEditable}`}
                onClick={() => { setEditOwner(true); setOwnerInput(item.owner ?? ""); }}
                title="Click to reassign"
              >
                {item.owner ?? <em className={styles.drawerMuted}>Unassigned — click to assign</em>}
              </span>
            )}
          </div>
          <DrawerField label="Route">{item.route_type.replace(/_/g, " ")}</DrawerField>
          {item.assigned_at && (
            <DrawerField label="Assigned">{fmtDate(item.assigned_at)}</DrawerField>
          )}
          {item.resolved_at && (
            <DrawerField label="Resolved">{fmtDate(item.resolved_at)}</DrawerField>
          )}
          {item.archived_at && (
            <DrawerField label="Archived">
              {fmtDate(item.archived_at)} by {item.archived_by ?? "—"}
            </DrawerField>
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
      </div>
    </>
  );
}

// ── Small helper ─────────────────────────────────────────────────────────────

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.drawerField}>
      <span className={styles.drawerLabel}>{label}</span>
      <span className={styles.drawerValue}>{children}</span>
    </div>
  );
}
