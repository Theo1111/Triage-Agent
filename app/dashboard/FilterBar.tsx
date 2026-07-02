"use client";

import styles from "./dashboard.module.css";
import { TEAM_TABS } from "@/src/config/roles";
import type { TabCounts } from "./types";

interface Props {
  counts: TabCounts;
  activeTeam: string;
  search: string;
  onTeamChange: (team: string) => void;
  onSearchChange: (search: string) => void;
}

export default function FilterBar({
  counts,
  activeTeam,
  search,
  onTeamChange,
  onSearchChange,
}: Props) {
  const countKey = (id: string): number =>
    (counts as unknown as Record<string, number>)[id] ?? 0;

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterChips}>
        {TEAM_TABS.map(tab => {
          const isActive =
            tab.id === "all" ? !activeTeam || activeTeam === "all" : activeTeam === tab.id;
          const count = countKey(tab.id);
          return (
            <button
              key={tab.id}
              className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
              onClick={() => onTeamChange(tab.id === "all" ? "" : tab.id)}
            >
              {tab.label}
              {count > 0 && <span className={styles.filterCount}>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search subject, sender…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
