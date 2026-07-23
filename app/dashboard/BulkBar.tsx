"use client";

import styles from "./dashboard.module.css";
import AssignMenu from "./AssignMenu";
import type { OperatorLite } from "@/src/lib/ownerDisplay";

export interface BulkResultSummary {
  successCount: number;
  failureCount: number;
  message: string;
  level: "success" | "partial" | "error";
}

interface Props {
  count: number;
  operators: OperatorLite[];
  busy: boolean;
  result: BulkResultSummary | null;
  onAssignSelf: () => void;
  onAssignOperator: (username: string) => void;
  onAssignTeam: (team: string) => void;
  onEscalate: () => void;
  onResolve: () => void;
  onArchive: () => void;
  onClear: () => void;
  onDismissResult: () => void;
}

// Sticky action bar shown when one or more cases are selected. Confirmation for
// Resolve/Archive is handled by the parent before invoking these callbacks.
export default function BulkBar({
  count,
  operators,
  busy,
  result,
  onAssignSelf,
  onAssignOperator,
  onAssignTeam,
  onEscalate,
  onResolve,
  onArchive,
  onClear,
  onDismissResult,
}: Props) {
  if (count === 0 && !result) return null;

  return (
    <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
      {count > 0 && (
        <>
          <span className={styles.bulkCount}>{count} selected</span>
          <div className={styles.bulkActions}>
            <button className={`${styles.btn} ${styles.btnAssign}`} onClick={onAssignSelf} disabled={busy}>
              Assign to me
            </button>
            <AssignMenu
              operators={operators}
              isAssigned={false}
              busy={busy}
              label="Assign to"
              onAssignSelf={onAssignSelf}
              onAssignOperator={onAssignOperator}
              onAssignTeam={onAssignTeam}
              onUnassign={() => {}}
            />
            <button className={`${styles.btn} ${styles.btnEscalate}`} onClick={onEscalate} disabled={busy}>
              Escalate
            </button>
            <button className={`${styles.btn} ${styles.btnResolve}`} onClick={onResolve} disabled={busy}>
              Resolve
            </button>
            <button className={`${styles.btn} ${styles.btnArchive}`} onClick={onArchive} disabled={busy}>
              Archive
            </button>
          </div>
          <button className={styles.bulkClear} onClick={onClear} disabled={busy}>
            Clear selection
          </button>
        </>
      )}

      {result && (
        <div
          className={[
            styles.bulkResult,
            result.level === "success" ? styles.bulkResultOk : "",
            result.level === "partial" ? styles.bulkResultPartial : "",
            result.level === "error" ? styles.bulkResultErr : "",
          ].join(" ")}
        >
          <span>{result.message}</span>
          <button className={styles.bulkResultDismiss} onClick={onDismissResult} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
