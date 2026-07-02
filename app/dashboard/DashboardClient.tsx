"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import FilterBar from "./FilterBar";
import TriageTable from "./TriageTable";
import { TEAM_CATEGORIES } from "@/src/config/roles";
import type { SerializedTriageItem, TabCounts } from "./types";

// ── Client-side filtering ──────────────────────────────────────────────────────
// Mirrors the server-side WHERE logic in page.tsx fetchAllItems so switching
// tabs is instant — no network round-trip needed.

function filterItems(
  all: SerializedTriageItem[],
  team: string,
  search: string
): SerializedTriageItem[] {
  let items = all;
  const CLOSED = ["resolved", "archived", "ignored"] as const;

  if (team === "archived") {
    items = items.filter(i => i.status === "archived");
  } else if (team === "resolved") {
    items = items.filter(i => i.status === "resolved");
  } else if (team === "manual_review") {
    items = items.filter(i => i.status === "manual_review");
  } else if (team === "urgent_open") {
    items = items.filter(
      i => i.urgency_level === "urgent" && !(CLOSED as readonly string[]).includes(i.status)
    );
  } else if (team === "assigned") {
    items = items.filter(i => i.status === "assigned" || i.status === "escalated");
  } else if (TEAM_CATEGORIES[team]) {
    const cats = TEAM_CATEGORIES[team];
    items = items.filter(
      i =>
        i.primary_category != null &&
        cats.includes(i.primary_category) &&
        !(CLOSED as readonly string[]).includes(i.status)
    );
  } else {
    // "all" — open items only
    items = items.filter(i => !(CLOSED as readonly string[]).includes(i.status));
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter(
      i =>
        i.subject?.toLowerCase().includes(q) ||
        i.sender_email?.toLowerCase().includes(q) ||
        i.sender_name?.toLowerCase().includes(q) ||
        i.summary?.toLowerCase().includes(q)
    );
  }

  return items;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  initialItems: SerializedTriageItem[];
  counts: TabCounts;
  initialTeam: string;
  initialSearch: string;
}

export default function DashboardClient({
  initialItems,
  counts,
  initialTeam,
  initialSearch,
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  const [activeTeam, setActiveTeam] = useState(initialTeam);
  const [search,     setSearch]     = useState(initialSearch);
  const [allItems,   setAllItems]   = useState(initialItems);

  // When server rerenders (router.refresh()), pull in fresh items + counts.
  useEffect(() => {
    setAllItems(initialItems);
  }, [initialItems]);

  // Light polling — refreshes counts and picks up Slack-side changes within 60s.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  // Update URL so tabs are bookmarkable and back-button works.
  const updateUrl = useCallback(
    (team: string, q: string) => {
      const p = new URLSearchParams();
      if (team && team !== "all") p.set("team", team);
      if (q.trim()) p.set("search", q.trim());
      const qs = p.toString();
      router.replace(`${pathname}${qs ? "?" + qs : ""}`, { scroll: false });
    },
    [router, pathname]
  );

  function handleTeamChange(team: string) {
    setActiveTeam(team);
    updateUrl(team, search);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrl(activeTeam, value);
  }

  function handleItemUpdated(updated: SerializedTriageItem) {
    setAllItems(prev =>
      prev.map(i => (i.id === updated.id ? { ...i, ...updated } : i))
    );
  }

  // Called after status-changing actions so counts update promptly.
  function handleRefresh() {
    router.refresh();
  }

  const items = filterItems(allItems, activeTeam, search);

  return (
    <>
      <FilterBar
        counts={counts}
        activeTeam={activeTeam}
        search={search}
        onTeamChange={handleTeamChange}
        onSearchChange={handleSearchChange}
      />
      <TriageTable
        items={items}
        onItemUpdated={handleItemUpdated}
        onRefresh={handleRefresh}
      />
    </>
  );
}
