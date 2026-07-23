"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./dashboard.module.css";
import { ASSIGNABLE_TEAMS, TEAM_LABELS } from "@/src/config/roles";
import type { OperatorLite } from "@/src/lib/ownerDisplay";

interface Props {
  operators: OperatorLite[];
  isAssigned: boolean;
  busy?: boolean;
  // Compact renders a smaller trigger button (used inside dense table rows).
  compact?: boolean;
  label?: string;
  onAssignSelf: () => void;
  onAssignOperator: (username: string) => void;
  onAssignTeam: (team: string) => void;
  onUnassign: () => void;
}

// Accessible assignment control that replaces the old window.prompt() flow.
// Offers: Assign to me · searchable operator list · team assignment · unassign.
export default function AssignMenu({
  operators,
  isAssigned,
  busy,
  compact,
  label,
  onAssignSelf,
  onAssignOperator,
  onAssignTeam,
  onUnassign,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    // Focus the search field when the menu opens.
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = operators.filter(op => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      op.username.toLowerCase().includes(needle) ||
      (op.displayName ?? "").toLowerCase().includes(needle)
    );
  });

  function choose(fn: () => void) {
    setOpen(false);
    setQ("");
    fn();
  }

  return (
    <div className={styles.assignRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnAssign} ${compact ? "" : styles.assignTriggerWide}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(o => !o)}
      >
        {label ?? "Assign"} ▾
      </button>

      {open && (
        <div className={styles.assignMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.assignMenuItemPrimary}
            onClick={() => choose(onAssignSelf)}
          >
            ✅ Assign to me
          </button>

          {isAssigned && (
            <button
              type="button"
              role="menuitem"
              className={styles.assignMenuItem}
              onClick={() => choose(onUnassign)}
            >
              ↩️ Unassign / clear owner
            </button>
          )}

          <div className={styles.assignMenuLabel}>Assign to operator</div>
          <input
            ref={searchRef}
            type="search"
            className={styles.assignSearch}
            placeholder="Search operators…"
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="Search operators"
          />
          <div className={styles.assignMenuScroll}>
            {filtered.length === 0 ? (
              <div className={styles.assignMenuEmpty}>No operators found</div>
            ) : (
              filtered.map(op => (
                <button
                  key={op.id}
                  type="button"
                  role="menuitem"
                  className={styles.assignMenuItem}
                  onClick={() => choose(() => onAssignOperator(op.username))}
                >
                  {op.displayName || op.username}
                  {op.displayName && (
                    <span className={styles.assignMenuSub}>{op.username}</span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className={styles.assignMenuLabel}>Assign to team</div>
          <div className={styles.assignTeamRow}>
            {ASSIGNABLE_TEAMS.map(team => (
              <button
                key={team}
                type="button"
                role="menuitem"
                className={styles.assignTeamChip}
                onClick={() => choose(() => onAssignTeam(team))}
              >
                {TEAM_LABELS[team] ?? team}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
