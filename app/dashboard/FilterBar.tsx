"use client";

import styles from "./dashboard.module.css";
import { TEAM_TABS } from "@/src/config/roles";
import type { TabCounts, CurrentOperator } from "./types";
import type { OperatorLite } from "@/src/lib/ownerDisplay";

interface Props {
  counts: TabCounts;
  activeTeam: string;
  search: string;
  operators: OperatorLite[];
  currentOperator: CurrentOperator | null;
  ownerFilter: string;
  onTeamChange: (team: string) => void;
  onSearchChange: (search: string) => void;
  onOwnerFilterChange: (owner: string) => void;
}

export default function FilterBar({
  counts,
  activeTeam,
  search,
  operators,
  currentOperator,
  ownerFilter,
  onTeamChange,
  onSearchChange,
  onOwnerFilterChange,
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
              aria-pressed={isActive}
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
          aria-label="Search cases"
        />
        <select
          className={styles.ownerFilterSelect}
          value={ownerFilter}
          onChange={e => onOwnerFilterChange(e.target.value)}
          aria-label="Filter by owner"
        >
          <option value="">All owners</option>
          {currentOperator && <option value="me">My cases</option>}
          <option value="unassigned">Unassigned</option>
          <optgroup label="Operators">
            {operators.map(op => (
              <option key={op.id} value={op.username}>
                {op.displayName || op.username}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
    </div>
  );
}
