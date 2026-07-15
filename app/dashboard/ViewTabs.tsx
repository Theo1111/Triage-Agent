"use client";

import type { DashboardView } from "./types";
import styles from "./dashboard.module.css";

interface Props {
  activeView: DashboardView;
  agentCount: number;
  onViewChange: (view: DashboardView) => void;
}

const VIEWS: { id: DashboardView; label: string }[] = [
  { id: "queue", label: "Triage Queue" },
  { id: "agent", label: "Triage Agent" },
];

export default function ViewTabs({ activeView, agentCount, onViewChange }: Props) {
  return (
    <div className={styles.viewTabs} role="tablist" aria-label="Dashboard view">
      {VIEWS.map(view => {
        const isActive = activeView === view.id;
        return (
          <button
            key={view.id}
            role="tab"
            aria-selected={isActive}
            className={`${styles.viewTab} ${isActive ? styles.viewTabActive : ""}`}
            onClick={() => onViewChange(view.id)}
          >
            {view.label}
            {view.id === "agent" && agentCount > 0 && (
              <span className={styles.viewTabCount}>{agentCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
