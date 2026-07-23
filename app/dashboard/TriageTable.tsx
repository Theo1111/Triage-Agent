"use client";

import { useState } from "react";
import type { SerializedTriageItem, CurrentOperator } from "./types";
import styles from "./dashboard.module.css";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import { formatTorontoDateTimeShort } from "@/src/lib/formatDate";
import { deriveTriageDisplayState } from "@/src/lib/triageDisplayState";
import { resolveOwner, type OperatorLite } from "@/src/lib/ownerDisplay";
import { TEAM_LABELS } from "@/src/config/roles";
import { isSlaBreached } from "@/src/config/sla";
import DetailDrawer from "./DetailDrawer";
import AssignMenu from "./AssignMenu";
import MoreMenu, { type MoreMenuItem } from "./MoreMenu";

interface Props {
  items: SerializedTriageItem[];
  operators: OperatorLite[];
  currentOperator: CurrentOperator | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAllVisible: (ids: string[], select: boolean) => void;
  onItemUpdated: (updated: SerializedTriageItem) => void;
  onRefresh: () => void;
}

const URGENCY_CLASS: Record<string, string> = {
  urgent:       styles.badgeUrgent,
  normal:       styles.badgeNormal,
  not_relevant: styles.badgeNotRelevant,
  unknown:      styles.badgeUnknown,
};
// "new" intentionally omitted — the internal lifecycle value is kept, but no
// blue NEW badge is rendered (see requirement 1).
const STATUS_CLASS: Record<string, string> = {
  assigned:      styles.statusAssigned,
  escalated:     styles.statusEscalated,
  manual_review: styles.statusManualReview,
  resolved:      styles.statusResolved,
  ignored:       styles.statusIgnored,
  archived:      styles.statusArchived,
};

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
  return formatTorontoDateTimeShort(iso);
}

export default function TriageTable({
  items,
  operators,
  currentOperator,
  selectedIds,
  onToggleSelect,
  onToggleSelectAllVisible,
  onItemUpdated,
  onRefresh,
}: Props) {
  const [selectedItem, setSelectedItem] = useState<SerializedTriageItem | null>(null);
  const [loadingId,    setLoadingId]    = useState<string | null>(null);
  const [errors,       setErrors]       = useState<Record<string, string>>({});

  async function quickAction(
    id: string,
    endpoint: string,
    body: Record<string, unknown> = {}
  ) {
    setLoadingId(id);
    setErrors(prev => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/dashboard/triage/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageItemId: id, ...body }),
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
        onItemUpdated(json.triageItem);
        if (selectedItem?.id === id) {
          setSelectedItem(prev => (prev ? { ...prev, ...json.triageItem } : prev));
        }
      }
      onRefresh();
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setLoadingId(null);
    }
  }

  function handleItemUpdatedFromDrawer(updated: SerializedTriageItem) {
    onItemUpdated(updated);
    setSelectedItem(prev => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
    onRefresh();
  }

  if (items.length === 0) {
    return <p className={styles.empty}>No items match the current filter.</p>;
  }

  const visibleIds = items.map(i => i.id);
  const allVisibleSelected = visibleIds.every(id => selectedIds.has(id));

  return (
    <>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkCol}>
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={allVisibleSelected}
                  onChange={e => onToggleSelectAllVisible(visibleIds, e.target.checked)}
                />
              </th>
              <th>Status</th>
              <th>Subject</th>
              <th>Sender</th>
              <th>Owner</th>
              <th>Category</th>
              <th>Age</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const ms         = ageMs(item.created_at);
              const isSelected = selectedItem?.id === item.id;
              const isChecked  = selectedIds.has(item.id);
              const isLoading  = loadingId === item.id;
              const ds         = deriveTriageDisplayState(item);
              const owner      = resolveOwner(item.owner, operators);
              const breached   = isSlaBreached(item);

              const moreItems: MoreMenuItem[] = [];
              if (ds.isActive) {
                moreItems.push(
                  ds.isEscalated
                    ? { key: "unescalate", label: "↘️ Unescalate", onClick: () => quickAction(item.id, "unescalate") }
                    : { key: "escalate", label: "🔺 Escalate", onClick: () => quickAction(item.id, "escalate") }
                );
              }
              if (ds.isResolved) {
                moreItems.push({ key: "reopen", label: "🔄 Reopen", onClick: () => quickAction(item.id, "reopen") });
              }
              if (ds.isArchived) {
                moreItems.push({ key: "restore", label: "↩️ Restore", onClick: () => quickAction(item.id, "unarchive") });
              } else {
                moreItems.push({
                  key: "archive",
                  label: "🗄️ Archive",
                  danger: true,
                  onClick: () => {
                    if (window.confirm("Archive this case? It will leave the active queue.")) {
                      quickAction(item.id, "archive");
                    }
                  },
                });
              }
              moreItems.push({ key: "view", label: "📬 View full email", href: `/emails/${item.inbound_email_id}` });

              return (
                <tr
                  key={item.id}
                  className={[
                    item.urgency_level === "urgent" ? styles.rowUrgent : styles.rowNormal,
                    isSelected ? styles.rowSelected : "",
                    isChecked ? styles.rowChecked : "",
                  ].join(" ")}
                  onClick={() => setSelectedItem(isSelected ? null : item)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Select */}
                  <td className={styles.checkCol} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.subject ?? "case"}`}
                      checked={isChecked}
                      onChange={() => onToggleSelect(item.id)}
                    />
                  </td>

                  {/* Status */}
                  <td onClick={e => e.stopPropagation()}>
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${URGENCY_CLASS[item.urgency_level] ?? styles.badgeUnknown}`}>
                        {item.urgency_level}
                      </span>
                      {STATUS_CLASS[item.status] && (
                        <span className={`${styles.badge} ${STATUS_CLASS[item.status]}`}>
                          {item.status.replace(/_/g, " ")}
                        </span>
                      )}
                      {breached && ds.isActive && (
                        <span className={`${styles.badge} ${styles.badgeSla}`}>SLA</span>
                      )}
                      {item.has_unread_update && (
                        <span className={`${styles.badge} ${styles.badgeNewInfo}`}>Updated</span>
                      )}
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
                    {item.sender_name && <div className={styles.senderName}>{item.sender_name}</div>}
                    <div className={styles.senderEmail}>{item.sender_email ?? "—"}</div>
                  </td>

                  {/* Owner */}
                  <td className={styles.ownerCell}>
                    {owner.kind === "unassigned" ? (
                      <div className={styles.ownerUnassignedWrap}>
                        <span className={styles.ownerUnassigned}>Unassigned</span>
                        {item.recommended_owner && (
                          <span className={styles.ownerSuggest}>
                            → {TEAM_LABELS[item.recommended_owner] ?? formatCategoryLabel(item.recommended_owner)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span
                        className={`${styles.ownerTag} ${owner.kind === "team" ? styles.ownerTagTeam : ""}`}
                      >
                        {owner.label}
                      </span>
                    )}
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

                  {/* Age */}
                  <td className={styles.ageCell}>
                    <span className={ageClass(ms)}>{ageString(ms)}</span>
                    <div className={styles.updatedAt}>{fmtDate(item.updated_at)}</div>
                  </td>

                  {/* Actions */}
                  <td className={styles.actionsCell} onClick={e => e.stopPropagation()}>
                    <div className={styles.actionBtns}>
                      {ds.isActive && (
                        <>
                          <AssignMenu
                            operators={operators}
                            isAssigned={ds.isAssigned}
                            busy={isLoading}
                            compact
                            onAssignSelf={() => quickAction(item.id, "assign", { ownerKind: "self" })}
                            onAssignOperator={u => quickAction(item.id, "assign", { ownerKind: "operator", owner: u })}
                            onAssignTeam={t => quickAction(item.id, "assign", { ownerKind: "team", owner: t })}
                            onUnassign={() => quickAction(item.id, "unassign")}
                          />
                          <button
                            className={`${styles.btn} ${styles.btnResolve}`}
                            onClick={() => {
                              if (window.confirm("Resolve this case? It will leave the active queue.")) {
                                quickAction(item.id, "resolve");
                              }
                            }}
                            disabled={isLoading}
                          >
                            Resolve
                          </button>
                        </>
                      )}
                      <MoreMenu items={moreItems} busy={isLoading} />
                    </div>
                    {errors[item.id] && <div className={styles.actionError}>{errors[item.id]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DetailDrawer
        item={selectedItem}
        operators={operators}
        currentOperator={currentOperator}
        onClose={() => setSelectedItem(null)}
        onItemUpdated={handleItemUpdatedFromDrawer}
      />
    </>
  );
}
