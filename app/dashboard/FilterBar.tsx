"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import styles from "./dashboard.module.css";
import { TEAM_TABS } from "@/src/config/roles";
import type { TabCounts } from "./types";

interface Props {
  counts: TabCounts;
  activeTeam: string;
  search: string;
}

export default function FilterBar({ counts, activeTeam, search }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setParam("search", e.target.value);
  }

  function handleTeam(teamId: string) {
    setParam("team", teamId === "all" ? "" : teamId);
  }

  const countKey = (id: string): number => {
    return (counts as unknown as Record<string, number>)[id] ?? 0;
  };

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterChips}>
        {TEAM_TABS.map(tab => {
          const isActive = activeTeam === tab.id;
          const count = countKey(tab.id);
          return (
            <button
              key={tab.id}
              className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
              onClick={() => handleTeam(tab.id)}
            >
              {tab.label}
              {count > 0 && (
                <span className={styles.filterCount}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search subject, sender, summary…"
          defaultValue={search}
          onChange={handleSearch}
        />
      </div>
    </div>
  );
}
